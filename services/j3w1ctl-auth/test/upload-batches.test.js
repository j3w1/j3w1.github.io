import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS } from "../src/content.js";
import { conflict, publicationUnknown } from "../src/errors.js";
import { createUploadBatchManager, STAGING_RETENTION_SECONDS } from "../src/upload-batches.js";
import { createMemoryStore } from "./helpers.js";

const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/v89WAAAAA==", "base64");
const session = { sub: "42", login: "j3w1", sessionId: "session-digest" };
const metadata = {
  title: "Fixture set",
  slug: "fixture-set",
  date: "2026-08-31",
  caption: "A fixture.",
  images: [{ id: "image-01", file: "image-01.webp", thumbnail: "image-01-thumb.webp", alt: "Fixture" }],
};

const harness = ({ publish } = {}) => {
  let current = 10_000;
  const store = createMemoryStore({ now: () => current });
  const objects = new Map();
  const removed = [];
  const blobStore = {
    objects,
    removed,
    async listPrefix(prefix) { return [...objects.values()].filter(({ pathname }) => pathname.startsWith(prefix)).map(({ bytes, contentType, ...item }) => ({ ...item })); },
    async read(pathname) { const value = objects.get(pathname); return value ? { ...value, bytes: Buffer.from(value.bytes) } : null; },
    async remove(paths) { for (const pathname of paths) { removed.push(pathname); objects.delete(pathname); } },
  };
  const calls = [];
  const repository = {
    async publish(value) {
      calls.push(value);
      if (publish) return publish(value);
      return { commitSha: "3".repeat(40) };
    },
  };
  const manager = createUploadBatchManager({ store, blobStore, repository, now: () => current });
  const stage = (pathname, bytes = webp, overrides = {}) => objects.set(pathname, {
    pathname,
    contentType: "image/webp",
    size: bytes.length,
    uploadedAt: new Date(current * 1000),
    bytes,
    ...overrides,
  });
  return { manager, store, blobStore, calls, stage, now: () => current, advance: (seconds) => { current += seconds; } };
};

const createBatch = (manager, overrides = {}) => manager.create({
  session,
  ifNoneMatch: "*",
  ...overrides,
  body: { collection: "photography", slug: "fixture-set", action: "create", imageIds: ["image-01"], ...overrides.body },
});

test("authenticated upload batches derive private paths and authorize WebP pairs only", async () => {
  const { manager } = harness();
  const batch = await createBatch(manager);
  assert.match(batch.id, /^[A-Za-z0-9_-]{32}$/);
  assert.match(batch.uploadCapability, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(batch.uploads, [{
    imageId: "image-01",
    full: `staging/j3w1ctl/${batch.id}/image-01/full.webp`,
    thumbnail: `staging/j3w1ctl/${batch.id}/image-01/thumbnail.webp`,
  }]);
  const clientPayload = JSON.stringify({ batchId: batch.id, capability: batch.uploadCapability, imageId: "image-01", kind: "full" });
  const policy = await manager.authorizeUpload({ id: batch.id, pathname: batch.uploads[0].full, clientPayload });
  assert.deepEqual(policy.allowedContentTypes, ["image/webp"]);
  assert.equal(policy.maximumSizeInBytes, LIMITS.fullImageBytes);
  assert.equal(policy.addRandomSuffix, false);
  await assert.rejects(
    () => manager.authorizeUpload({ id: batch.id, pathname: `staging/j3w1ctl/${batch.id}/escape.webp`, clientPayload }),
    (error) => error.code === "invalid_upload_path",
  );
  await assert.rejects(
    () => manager.authorizeUpload({ id: batch.id, pathname: batch.uploads[0].full, clientPayload: JSON.stringify({ batchId: batch.id, capability: "x".repeat(43), imageId: "image-01", kind: "full" }) }),
    (error) => error.statusCode === 401,
  );
});

test("batch creation enforces action preconditions, unique IDs, and the image ceiling", async () => {
  const { manager } = harness();
  await assert.rejects(() => createBatch(manager, { ifNoneMatch: undefined }), /If-None-Match/i);
  await assert.rejects(() => createBatch(manager, { body: { imageIds: ["same", "same"] } }), /unique/i);
  await assert.rejects(() => createBatch(manager, { body: { imageIds: Array.from({ length: 13 }, (_, index) => `image-${index}`) } }), /at most 12/i);
  await assert.rejects(() => manager.create({
    session,
    body: { collection: "photography", slug: "fixture-set", action: "update", imageIds: [] },
    ifMatch: "invalid",
  }), /exact current ETag/i);
});

test("finalize revalidates exact private objects, binds the owner session, commits once, and deletes staging", async () => {
  const { manager, calls, stage, blobStore } = harness();
  const batch = await createBatch(manager);
  stage(batch.uploads[0].full);
  stage(batch.uploads[0].thumbnail);
  await assert.rejects(
    () => manager.finalize({ id: batch.id, session: { ...session, sessionId: "other" }, metadata, verifySession: async () => session }),
    (error) => error.statusCode === 403,
  );
  const result = await manager.finalize({ id: batch.id, session, metadata, verifySession: async () => session });
  assert.equal(result.commitSha, "3".repeat(40));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].uploads.get("image-01").full.equals(webp), true);
  assert.equal(calls[0].uploads.get("image-01").thumbnail.equals(webp), true);
  assert.equal(blobStore.objects.size, 0);
  await assert.rejects(
    () => manager.finalize({ id: batch.id, session, metadata, verifySession: async () => session }),
    /already being finalized|closed/i,
  );
  assert.equal(calls.length, 1);
});

test("missing, extra, wrong-MIME, and oversize objects terminate invalid batches without publication", async () => {
  for (const arrange of [
    ({ batch, stage }) => stage(batch.uploads[0].full),
    ({ batch, stage }) => { stage(batch.uploads[0].full); stage(batch.uploads[0].thumbnail); stage(`staging/j3w1ctl/${batch.id}/extra.webp`); },
    ({ batch, stage }) => { stage(batch.uploads[0].full, webp, { contentType: "image/png" }); stage(batch.uploads[0].thumbnail); },
    ({ batch, stage }) => { stage(batch.uploads[0].full, webp, { size: LIMITS.fullImageBytes + 1 }); stage(batch.uploads[0].thumbnail); },
  ]) {
    const current = harness();
    const batch = await createBatch(current.manager);
    arrange({ batch, stage: current.stage });
    await assert.rejects(
      () => current.manager.finalize({ id: batch.id, session, metadata, verifySession: async () => session }),
      (error) => error.code === "invalid_image",
    );
    assert.equal(current.calls.length, 0);
  }
});

test("logout during finalize blocks the commit and claim races permit one attempt", async () => {
  const current = harness();
  const batch = await createBatch(current.manager);
  current.stage(batch.uploads[0].full);
  current.stage(batch.uploads[0].thumbnail);
  await assert.rejects(
    () => current.manager.finalize({ id: batch.id, session, metadata, verifySession: async () => { throw Object.assign(new Error("expired"), { statusCode: 401 }); } }),
    /expired/,
  );
  assert.equal(current.calls.length, 0);
  const race = harness();
  const racedBatch = await createBatch(race.manager);
  race.stage(racedBatch.uploads[0].full);
  race.stage(racedBatch.uploads[0].thumbnail);
  const results = await Promise.allSettled([
    race.manager.finalize({ id: racedBatch.id, session, metadata, verifySession: async () => session }),
    race.manager.finalize({ id: racedBatch.id, session, metadata, verifySession: async () => session }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(race.calls.length, 1);
});

test("GitHub conflicts delete staging while ambiguous results retain it for bounded investigation", async () => {
  for (const [errorFactory, retained] of [[conflict, false], [publicationUnknown, true]]) {
    const current = harness({ publish: async () => { throw errorFactory(); } });
    const batch = await createBatch(current.manager);
    current.stage(batch.uploads[0].full);
    current.stage(batch.uploads[0].thumbnail);
    await assert.rejects(() => current.manager.finalize({ id: batch.id, session, metadata, verifySession: async () => session }));
    assert.equal(current.calls.length, 1);
    assert.equal(current.blobStore.objects.size > 0, retained);
  }
});

test("cancel and cleanup delete only the server staging prefix", async () => {
  const current = harness();
  const batch = await createBatch(current.manager);
  current.stage(batch.uploads[0].full);
  current.stage("canonical/never-delete.webp", webp, { uploadedAt: new Date(0) });
  await current.manager.cancel({ id: batch.id, session });
  assert.equal(current.blobStore.objects.has(batch.uploads[0].full), false);
  current.stage("staging/j3w1ctl/abandoned/old.webp", webp, { uploadedAt: new Date((current.now() - STAGING_RETENTION_SECONDS - 1) * 1000) });
  const result = await current.manager.cleanup();
  assert.deepEqual(result, { scanned: 1, deleted: 1 });
  assert.equal(current.blobStore.objects.has("canonical/never-delete.webp"), true);
});

test("cancel cannot delete staging after finalize has claimed the batch", async () => {
  let releaseRead;
  const readStarted = new Promise((resolve) => { releaseRead = resolve; });
  let continueRead;
  const waitForContinue = new Promise((resolve) => { continueRead = resolve; });
  const current = harness();
  const originalList = current.blobStore.listPrefix;
  current.blobStore.listPrefix = async (prefix) => {
    releaseRead();
    await waitForContinue;
    return originalList(prefix);
  };
  const batch = await createBatch(current.manager);
  current.stage(batch.uploads[0].full);
  current.stage(batch.uploads[0].thumbnail);
  const finalizing = current.manager.finalize({ id: batch.id, session, metadata, verifySession: async () => session });
  await readStarted;
  await current.manager.cancel({ id: batch.id, session });
  assert.equal(current.blobStore.objects.size, 2);
  continueRead();
  await finalizing;
});
