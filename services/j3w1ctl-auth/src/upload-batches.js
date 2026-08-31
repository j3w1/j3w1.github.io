import { createHash, randomBytes } from "node:crypto";
import { LIMITS, entryPath, mediaPath, validateWebp } from "./content.js";
import {
  STAGING_PREFIX,
  UPLOAD_BATCH_SCHEMA_VERSION,
  UPLOAD_BATCH_TTL_SECONDS,
} from "./constants.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "./errors.js";

export const STAGING_RETENTION_SECONDS = 6 * 60 * 60;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BATCH_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const VERSION_PATTERN = /^"[0-9a-f]{40,64}"$/i;

const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const batchKey = (id) => `upload:v1:${id}`;
const claimKey = (id) => `upload-claim:v1:${id}`;
const batchPrefix = (id) => `${STAGING_PREFIX}${id}/`;

const assertSession = (record, session) => {
  if (record.ownerUserId !== session.sub || record.ownerLogin !== session.login || record.sessionId !== session.sessionId) {
    throw forbidden("This upload batch does not belong to the current session.");
  }
};

const parseClientPayload = (value) => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw badRequest("invalid_upload_capability", "The upload capability is invalid.");
  }
};

const safeDelete = async (blobStore, paths) => {
  try {
    await blobStore.remove(paths);
  } catch {
    // Cleanup is retried by the bounded provider cron; never obscure the publication result.
  }
};

export const createUploadBatchManager = ({ store, blobStore, repository, now = () => Math.floor(Date.now() / 1000) }) => {
  const load = async (id) => {
    if (!BATCH_PATTERN.test(id)) throw notFound();
    const record = await store.get(batchKey(id));
    if (!record || record.schemaVersion !== UPLOAD_BATCH_SCHEMA_VERSION) throw notFound();
    return record;
  };

  const create = async ({ session, body, ifMatch, ifNoneMatch }) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("invalid_request", "A JSON object is required.");
    const { collection, slug, action, imageIds } = body;
    if (collection !== "photography") throw badRequest("invalid_collection", "Only photography upload batches are supported.");
    entryPath("photography", slug);
    if (!['create', 'update'].includes(action)) throw badRequest("invalid_action", "The upload action is invalid.");
    if (action === "create" && ifNoneMatch !== "*") throw conflict("A create upload batch requires If-None-Match: *.");
    if (action === "update" && !VERSION_PATTERN.test(String(ifMatch ?? "").trim())) throw conflict("An update upload batch requires the exact current ETag.");
    if (!Array.isArray(imageIds) || imageIds.length > LIMITS.images || imageIds.some((id) => !ID_PATTERN.test(id))) {
      throw badRequest("invalid_image", `Upload batches accept at most ${LIMITS.images} valid image IDs.`);
    }
    const uniqueIds = [...new Set(imageIds)];
    if (uniqueIds.length !== imageIds.length) throw badRequest("invalid_image", "Image IDs must be unique.");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = randomBytes(24).toString("base64url");
      const capability = randomBytes(32).toString("base64url");
      const createdAt = now();
      const pairMap = Object.fromEntries(uniqueIds.map((imageId) => [imageId, {
        full: `${batchPrefix(id)}${imageId}/full.webp`,
        thumbnail: `${batchPrefix(id)}${imageId}/thumbnail.webp`,
      }]));
      const record = {
        schemaVersion: UPLOAD_BATCH_SCHEMA_VERSION,
        id,
        ownerUserId: session.sub,
        ownerLogin: session.login,
        sessionId: session.sessionId,
        slug,
        action,
        ifMatch: action === "update" ? String(ifMatch).trim() : undefined,
        ifNoneMatch: action === "create" ? "*" : undefined,
        expectedImageIds: uniqueIds,
        pairMap,
        capabilityDigest: digest(capability),
        createdAt,
        expiresAt: createdAt + UPLOAD_BATCH_TTL_SECONDS,
        state: "open",
      };
      if (await store.setIfAbsent(batchKey(id), record, UPLOAD_BATCH_TTL_SECONDS)) {
        return {
          id,
          expiresAt: record.expiresAt,
          uploadCapability: capability,
          uploads: uniqueIds.map((imageId) => ({ imageId, ...pairMap[imageId] })),
        };
      }
    }
    throw conflict("An upload batch could not be allocated. Try again.");
  };

  const authorizeUpload = async ({ id, pathname, clientPayload }) => {
    const payload = parseClientPayload(clientPayload);
    const record = await load(id);
    if (record.state !== "open" || record.expiresAt <= now()) throw conflict("The upload batch is closed or expired.");
    if (payload.batchId !== id || typeof payload.capability !== "string" || digest(payload.capability) !== record.capabilityDigest) {
      throw unauthorized("The upload capability is invalid or expired.");
    }
    const expected = record.pairMap?.[payload.imageId]?.[payload.kind];
    if (!expected || pathname !== expected || !["full", "thumbnail"].includes(payload.kind)) {
      throw badRequest("invalid_upload_path", "The upload path is not part of this batch.");
    }
    return {
      allowedContentTypes: ["image/webp"],
      maximumSizeInBytes: payload.kind === "thumbnail" ? LIMITS.thumbnailBytes : LIMITS.fullImageBytes,
      validUntil: record.expiresAt * 1000,
      allowOverwrite: false,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
      tokenPayload: JSON.stringify({ batchId: id, imageId: payload.imageId, kind: payload.kind }),
    };
  };

  const confirmUpload = async ({ blob, tokenPayload }) => {
    const payload = parseClientPayload(tokenPayload);
    const record = await load(payload.batchId);
    const expected = record.pairMap?.[payload.imageId]?.[payload.kind];
    if (!expected || blob?.pathname !== expected || blob?.contentType !== "image/webp") {
      throw badRequest("invalid_upload_path", "The completed upload does not belong to this batch.");
    }
  };

  const invalidate = async (record, reason, blobs) => {
    await store.set(batchKey(record.id), { ...record, state: "invalid", terminalReason: reason }, STAGING_RETENTION_SECONDS);
    await safeDelete(blobStore, blobs.map(({ pathname }) => pathname));
  };

  const finalize = async ({ id, session, metadata, verifySession }) => {
    const record = await load(id);
    assertSession(record, session);
    if (record.state !== "open" || record.expiresAt <= now()) throw conflict("The upload batch is closed or expired.");
    const claimed = await store.setIfAbsent(claimKey(id), { sessionId: session.sessionId, claimedAt: now() }, UPLOAD_BATCH_TTL_SECONDS);
    if (!claimed) throw conflict("The upload batch is already being finalized or has been consumed.");
    await store.set(batchKey(id), { ...record, state: "finalizing" }, UPLOAD_BATCH_TTL_SECONDS);

    const blobs = await blobStore.listPrefix(batchPrefix(id));
    const expectedPaths = new Set(Object.values(record.pairMap).flatMap(({ full, thumbnail }) => [full, thumbnail]));
    const actualPaths = new Set(blobs.map(({ pathname }) => pathname));
    if (expectedPaths.size !== actualPaths.size || [...expectedPaths].some((path) => !actualPaths.has(path))) {
      await invalidate(record, "object_set_mismatch", blobs);
      throw badRequest("invalid_image", "The staged image set is incomplete or contains unexpected objects.");
    }

    let total = 0;
    const uploads = new Map();
    try {
      for (const imageId of record.expectedImageIds) {
        const pair = {};
        for (const kind of ["full", "thumbnail"]) {
          const pathname = record.pairMap[imageId][kind];
          const listed = blobs.find((blob) => blob.pathname === pathname);
          const maximum = kind === "thumbnail" ? LIMITS.thumbnailBytes : LIMITS.fullImageBytes;
          if (!Number.isFinite(listed?.size) || listed.size > maximum) throw new Error("policy");
          const object = await blobStore.read(pathname);
          if (!object || object.contentType !== "image/webp" || object.bytes.length !== listed.size) throw new Error("policy");
          validateWebp(object.bytes, { thumbnail: kind === "thumbnail" });
          total += object.bytes.length;
          pair[kind] = object.bytes;
        }
        uploads.set(imageId, pair);
      }
      if (total > LIMITS.totalImageBytes) throw new Error("policy");
    } catch (error) {
      if (error?.statusCode === 503) throw error;
      await invalidate(record, "image_policy", blobs);
      throw badRequest("invalid_image", "The staged WebP set does not satisfy the photography policy.");
    }

    await verifySession();
    let result;
    try {
      result = await repository.publish({
        action: record.action,
        collection: "photography",
        slug: record.slug,
        metadata,
        body: "",
        uploads,
        ifMatch: record.ifMatch,
        ifNoneMatch: record.ifNoneMatch,
      });
    } catch (error) {
      if (error?.code === "content_conflict" || error?.code === "publication_failed") {
        await store.set(batchKey(id), { ...record, state: "conflict", terminalReason: error.code }, STAGING_RETENTION_SECONDS);
        await safeDelete(blobStore, blobs.map(({ pathname }) => pathname));
      } else if (error?.code === "publication_unknown") {
        await store.set(batchKey(id), { ...record, state: "hold", terminalReason: error.code }, STAGING_RETENTION_SECONDS);
      }
      throw error;
    }

    await store.set(batchKey(id), { ...record, state: "consumed", consumedAt: now(), commitSha: result.commitSha }, STAGING_RETENTION_SECONDS);
    await safeDelete(blobStore, blobs.map(({ pathname }) => pathname));
    return result;
  };

  const cancel = async ({ id, session }) => {
    const record = await load(id);
    assertSession(record, session);
    if (record.state !== "open") return;
    const blobs = await blobStore.listPrefix(batchPrefix(id));
    await store.set(batchKey(id), { ...record, state: "canceled", canceledAt: now() }, STAGING_RETENTION_SECONDS);
    await safeDelete(blobStore, blobs.map(({ pathname }) => pathname));
  };

  const cleanup = async () => {
    const ceiling = new Date((now() - STAGING_RETENTION_SECONDS) * 1000);
    const blobs = await blobStore.listPrefix(STAGING_PREFIX);
    const expired = blobs.filter(({ uploadedAt }) => new Date(uploadedAt) < ceiling).map(({ pathname }) => pathname);
    await blobStore.remove(expired);
    return { scanned: blobs.length, deleted: expired.length };
  };

  return Object.freeze({ create, authorizeUpload, confirmUpload, finalize, cancel, cleanup });
};
