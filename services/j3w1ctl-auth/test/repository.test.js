import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { conflict, publicationUnknown } from "../src/errors.js";
import { serializeEntry } from "../src/content.js";
import { createRepositoryService } from "../src/repository.js";

const blob = "1".repeat(40);
const head = "2".repeat(40);
const source = serializeEntry("writing", { title: "Old", slug: "old", date: "2026-08-20", summary: "Old summary", tags: [] }, "Old body");
const snapshot = () => ({ headSha: head, files: new Map([["content/writing/old.md", { sha: blob, size: Buffer.byteLength(source), source }]]) });

test("create regenerates the full index and performs one expected-head commit", async () => {
  const calls = [];
  const service = createRepositoryService({ getSnapshot: async () => snapshot(), createCommit: async (value) => { calls.push(value); return { commitSha: "3".repeat(40), commitUrl: "https://example.invalid/commit" }; } });
  await service.publish({ action: "create", collection: "writing", slug: "new", metadata: { title: "New", slug: "new", date: "2026-08-24", summary: "New summary", tags: [] }, body: "New body", ifNoneMatch: "*" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].expectedHeadOid, head);
  assert.deepEqual(calls[0].additions.map(({ path }) => path), ["content/writing/new.md", "assets/data/content-index.json"]);
  const index = JSON.parse(calls[0].additions[1].content.toString());
  assert.deepEqual(index.collections.writing.map(({ slug }) => slug), ["new", "old"]);
});

test("stale blobs and missing create preconditions fail before mutation", async () => {
  let commits = 0;
  const service = createRepositoryService({ getSnapshot: async () => snapshot(), createCommit: async () => { commits += 1; } });
  await assert.rejects(() => service.publish({ action: "update", collection: "writing", slug: "old", metadata: { title: "Old", slug: "old", date: "2026-08-20", summary: "Changed", tags: [] }, body: "Body", ifMatch: `"${"f".repeat(40)}"` }), /changed/i);
  await assert.rejects(() => service.publish({ action: "create", collection: "writing", slug: "new", metadata: {}, body: "" }), /version is required/i);
  assert.equal(commits, 0);
});

test("photography delete scope contains only derived entry media and the index", async () => {
  const photo = serializeEntry("photography", { title: "Set", slug: "set", date: "2026-08-24", caption: "Caption", images: [{ id: "one", file: "one.webp", thumbnail: "one-thumb.webp", alt: "Alt" }] });
  const calls = [];
  const files = new Map([["content/photography/set.md", { sha: blob, size: photo.length, source: photo }], ["assets/photography/set/one.webp", { sha: "a".repeat(40), size: 12 }], ["assets/photography/set/one-thumb.webp", { sha: "b".repeat(40), size: 12 }]]);
  const service = createRepositoryService({ getSnapshot: async () => ({ headSha: head, files }), createCommit: async (value) => { calls.push(value); return { commitSha: "4".repeat(40) }; } });
  await service.publish({ action: "delete", collection: "photography", slug: "set", ifMatch: `"${blob}"` });
  assert.deepEqual(calls[0].deletions.sort(), ["assets/photography/set/one-thumb.webp", "assets/photography/set/one.webp", "content/photography/set.md"].sort());
  assert.deepEqual(calls[0].additions.map(({ path }) => path), ["assets/data/content-index.json"]);
});

const gitBlobSha = (content) => {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1").update(`blob ${buffer.length}\0`).update(buffer).digest("hex");
};

const concurrentRace = async (left, right, initial = snapshot()) => {
  let readers = 0;
  let releaseReads;
  const bothRead = new Promise((resolve) => { releaseReads = resolve; });
  let currentHead = initial.headSha;
  let sequence = 0;
  const commitCalls = [];
  const github = {
    async getSnapshot() {
      readers += 1;
      if (readers === 2) releaseReads();
      await bothRead;
      return { headSha: initial.headSha, files: new Map(initial.files) };
    },
    async createCommit(value) {
      commitCalls.push(value);
      if (value.expectedHeadOid !== currentHead) throw conflict();
      currentHead = `${++sequence + 3}`.repeat(40);
      return { commitSha: currentHead };
    },
  };
  const instanceA = createRepositoryService(github);
  const instanceB = createRepositoryService(github);
  const results = await Promise.allSettled([instanceA.publish(left), instanceB.publish(right)]);
  return { results, commitCalls };
};

test("independent instances rely on expectedHeadOid without lost updates or stale retries", async () => {
  const createValue = (title) => ({
    action: "create",
    collection: "writing",
    slug: "same-slug",
    metadata: { title, slug: "same-slug", date: "2026-08-31", summary: `${title} summary`, tags: [] },
    body: title,
    ifNoneMatch: "*",
  });
  const createRace = await concurrentRace(createValue("Left"), createValue("Right"));
  assert.equal(createRace.results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(createRace.results.filter(({ status, reason }) => status === "rejected" && reason.code === "content_conflict").length, 1);
  assert.equal(createRace.commitCalls.length, 2);
  assert.equal(new Set(createRace.commitCalls.map(({ expectedHeadOid }) => expectedHeadOid)).size, 1);

  const update = {
    action: "update",
    collection: "writing",
    slug: "old",
    metadata: { title: "Updated", slug: "old", date: "2026-08-20", summary: "Changed", tags: [] },
    body: "Changed",
    ifMatch: `"${blob}"`,
  };
  const updateRace = await concurrentRace(update, { action: "delete", collection: "writing", slug: "old", ifMatch: `"${blob}"` });
  assert.equal(updateRace.results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(updateRace.results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(updateRace.commitCalls.length, 2);

  const dualUpdate = await concurrentRace(update, {
    ...update,
    metadata: { ...update.metadata, title: "Competing update", summary: "Competing" },
    body: "Competing",
  });
  assert.equal(dualUpdate.results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(dualUpdate.results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(dualUpdate.commitCalls.length, 2);
});

test("ambiguous publication performs one write and one readback classification without retry", async () => {
  let writeCalls = 0;
  let readCalls = 0;
  let intended;
  const github = {
    async getSnapshot() {
      readCalls += 1;
      if (readCalls === 1) return { headSha: head, files: new Map() };
      const files = new Map(intended.additions.map(({ path, content }) => [path, { sha: gitBlobSha(content), size: content.length, ...(path.endsWith(".md") || path.endsWith(".json") ? { source: content.toString("utf8") } : {}) }]));
      return { headSha: "9".repeat(40), files };
    },
    async createCommit(value) { writeCalls += 1; intended = value; throw publicationUnknown(); },
  };
  const service = createRepositoryService(github);
  const result = await service.publish({
    action: "create",
    collection: "writing",
    slug: "ambiguous",
    metadata: { title: "Ambiguous", slug: "ambiguous", date: "2026-08-31", summary: "Readback", tags: [] },
    body: "Body",
    ifNoneMatch: "*",
  });
  assert.equal(result.commitSha, "9".repeat(40));
  assert.equal(result.publicationOutcome, "PROVEN_SUCCESS_READBACK");
  assert.equal(writeCalls, 1);
  assert.equal(readCalls, 2);
});

test("ambiguous publication holds when a changed head does not prove the exact result", async () => {
  let writeCalls = 0;
  let readCalls = 0;
  const github = {
    async getSnapshot() {
      readCalls += 1;
      return readCalls === 1 ? { headSha: head, files: new Map() } : { headSha: "8".repeat(40), files: new Map() };
    },
    async createCommit() { writeCalls += 1; throw publicationUnknown(); },
  };
  const service = createRepositoryService(github);
  await assert.rejects(() => service.publish({
    action: "create",
    collection: "writing",
    slug: "unknown",
    metadata: { title: "Unknown", slug: "unknown", date: "2026-08-31", summary: "Hold", tags: [] },
    body: "Body",
    ifNoneMatch: "*",
  }), (error) => error.code === "publication_unknown");
  assert.equal(writeCalls, 1);
  assert.equal(readCalls, 2);
});
