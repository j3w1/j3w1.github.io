import { createHash } from "node:crypto";
import {
  COLLECTIONS,
  LIMITS,
  assertCollection,
  buildIndex,
  compileSource,
  entryPath,
  mediaPath,
  normalizeEntry,
  serializeEntry,
  stringifyIndex,
  validateWebp,
} from "./content.js";
import { AppError, badRequest, conflict, notFound, preconditionRequired, publicationUnknown } from "./errors.js";

const INDEX_PATH = "assets/data/content-index.json";

const gitBlobSha = (content) => {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1").update(`blob ${buffer.length}\0`).update(buffer).digest("hex");
};

const publicationMatches = (snapshot, additions, deletions) =>
  additions.every(({ path, content }) => snapshot.files.get(path)?.sha === gitBlobSha(content))
  && deletions.every((path) => !snapshot.files.has(path));

const sourceCollections = (files) => {
  const result = Object.fromEntries(COLLECTIONS.map((collection) => [collection, []]));
  for (const [filePath, file] of files) {
    const match = filePath.match(/^content\/(writing|books|photography)\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/);
    if (match && typeof file.source === "string") {
      result[match[1]].push({ path: filePath, source: file.source });
    }
  }
  return result;
};

const cleanVersion = (header) => {
  if (typeof header !== "string") return "";
  const match = header.trim().match(/^"([0-9a-f]{40,64})"$/i);
  return match?.[1] ?? "";
};

const findEntry = (snapshot, collection, slug) => {
  const path = entryPath(collection, slug);
  const file = snapshot.files.get(path);
  if (!file?.source) throw notFound();
  return { path, file, entry: compileSource(collection, file.source) };
};

const listEntries = (snapshot, collection) => {
  const prefix = `content/${collection}/`;
  return [...snapshot.files]
    .filter(([filePath, file]) => filePath.startsWith(prefix) && filePath.endsWith(".md") && typeof file.source === "string")
    .map(([filePath, file]) => ({
      ...compileSource(collection, file.source),
      version: file.sha,
      sourcePath: filePath,
    }))
    .sort((left, right) => (right.date ?? right.year ?? 0).toString().localeCompare((left.date ?? left.year ?? 0).toString()) || left.slug.localeCompare(right.slug));
};

const detailEntry = (snapshot, collection, slug) => {
  const { path, file, entry } = findEntry(snapshot, collection, slug);
  const parsedSource = file.source.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  return {
    entry,
    source: file.source,
    body: parsedSource?.[1]?.replace(/^\r?\n/, "").replace(/\s+$/, "") ?? "",
    version: file.sha,
    sourcePath: path,
    headSha: snapshot.headSha,
  };
};

const verifyPhotography = (snapshot, metadata, uploads, { creating = false } = {}) => {
  let total = 0;
  const additions = [];
  const imageIds = new Set(metadata.images.map(({ id }) => id));
  for (const id of uploads.keys()) {
    if (!imageIds.has(id)) throw badRequest("invalid_image", `Uploaded image ${id} is not present in metadata.`);
  }
  for (const image of metadata.images) {
    const pair = uploads.get(image.id);
    for (const thumbnail of [false, true]) {
      const path = mediaPath(metadata.slug, image.id, thumbnail);
      const buffer = thumbnail ? pair?.thumbnail : pair?.full;
      if (buffer) {
        validateWebp(buffer, { thumbnail });
        total += buffer.length;
        additions.push({ path, content: buffer });
      } else {
        const existing = snapshot.files.get(path);
        if (!existing) {
          if (creating) throw badRequest("invalid_image", `Photography asset ${path} must be uploaded as a full/thumbnail pair.`);
          throw conflict(`Photography asset ${path} is missing; select the pair again.`);
        }
        const maximum = thumbnail ? LIMITS.thumbnailBytes : LIMITS.fullImageBytes;
        if (!Number.isFinite(existing.size) || existing.size > maximum) {
          throw conflict(`Photography asset ${path} no longer meets the size policy.`);
        }
        total += existing.size;
      }
    }
  }
  if (total > LIMITS.totalImageBytes) {
    throw conflict(`Photography entry exceeds the ${LIMITS.totalImageBytes} byte total limit.`);
  }
  return additions;
};

export const createRepositoryService = (github) => {
  const readSnapshot = () => github.getSnapshot();

  const list = async (collection) => {
    assertCollection(collection);
    const snapshot = await readSnapshot();
    return { collection, entries: listEntries(snapshot, collection), headSha: snapshot.headSha };
  };

  const get = async (collection, slug) => {
    assertCollection(collection);
    return detailEntry(await readSnapshot(), collection, slug);
  };

  const publish = async ({ action, collection, slug, metadata, body = "", uploads = new Map(), ifMatch, ifNoneMatch }) => {
      assertCollection(collection);
      const targetPath = entryPath(collection, slug);
      const snapshot = await readSnapshot();
      const existing = snapshot.files.get(targetPath);

      if (action === "create") {
        if (ifNoneMatch !== "*") throw preconditionRequired();
        if (existing) throw conflict("That slug has already been published and cannot be reused.");
      } else {
        const expectedBlob = cleanVersion(ifMatch);
        if (!expectedBlob) throw preconditionRequired();
        if (!existing?.source) throw notFound();
        if (existing.sha !== expectedBlob) throw conflict();
      }

      const sources = sourceCollections(snapshot.files);
      const additions = [];
      const deletions = [];
      let normalized;

      if (action === "delete") {
        if (collection === "photography") {
          const old = compileSource(collection, existing.source);
          for (const image of old.images) {
            for (const path of [mediaPath(slug, image.id), mediaPath(slug, image.id, true)]) {
              if (!snapshot.files.has(path)) throw conflict(`Photography asset ${path} is missing; deletion was not attempted.`);
              deletions.push(path);
            }
          }
        }
        deletions.push(targetPath);
        sources[collection] = sources[collection].filter(({ path }) => path !== targetPath);
      } else {
        normalized = normalizeEntry(collection, { ...metadata, slug }, body);
        const source = serializeEntry(collection, normalized.metadata, normalized.body);
        sources[collection] = sources[collection].filter(({ path }) => path !== targetPath);
        sources[collection].push({ path: targetPath, source });
        additions.push({ path: targetPath, content: Buffer.from(source, "utf8") });
        if (collection === "photography") additions.push(...verifyPhotography(snapshot, normalized.metadata, uploads, { creating: !existing }));

        if (collection === "photography" && existing?.source) {
          const retained = new Set(normalized.metadata.images.flatMap((image) => [
            mediaPath(slug, image.id),
            mediaPath(slug, image.id, true),
          ]));
          const old = compileSource(collection, existing.source);
          for (const image of old.images) {
            for (const filePath of [mediaPath(slug, image.id), mediaPath(slug, image.id, true)]) {
              if (!retained.has(filePath)) deletions.push(filePath);
            }
          }
        }
      }

      const index = buildIndex(sources);
      additions.push({ path: INDEX_PATH, content: Buffer.from(stringifyIndex(index), "utf8") });
      const uniqueDeletions = [...new Set(deletions)];
      let result;
      try {
        result = await github.createCommit({
          expectedHeadOid: snapshot.headSha,
          headline: `cms: ${action} ${collection}/${slug}`,
          additions,
          deletions: uniqueDeletions,
        });
      } catch (error) {
        if (error?.code !== "publication_unknown") throw error;
        const readback = await readSnapshot();
        if (readback.headSha !== snapshot.headSha && publicationMatches(readback, additions, uniqueDeletions)) {
          result = { commitSha: readback.headSha, publicationOutcome: "PROVEN_SUCCESS_READBACK" };
        } else if (readback.headSha === snapshot.headSha) {
          throw new AppError(503, "publication_failed", "GitHub did not apply the publication. No retry was attempted.");
        } else {
          throw publicationUnknown();
        }
      }
      return {
        ...result,
        headSha: result.commitSha,
        ...(normalized ? { entry: compileSource(collection, additions[0].content.toString("utf8")) } : {}),
        deletedPaths: action === "delete" ? uniqueDeletions : undefined,
      };
  };

  return { list, get, publish };
};
