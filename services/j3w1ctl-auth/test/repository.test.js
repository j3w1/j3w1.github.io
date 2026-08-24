import assert from "node:assert/strict";
import test from "node:test";
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

