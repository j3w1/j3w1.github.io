import assert from "node:assert/strict";
import test from "node:test";
import { createBlobStore } from "../src/blob-store.js";

const config = { blobToken: "test-private-blob-token" };

test("private Blob adapter bounds pagination and never returns more than the requested ceiling", async () => {
  const calls = [];
  const listImpl = async ({ prefix, limit, cursor, token }) => {
    calls.push({ prefix, limit, cursor, token });
    const start = cursor ? Number(cursor) : 0;
    const blobs = Array.from({ length: limit }, (_, offset) => ({ pathname: `${prefix}${start + offset}`, size: 1, uploadedAt: new Date(0) }));
    return { blobs, hasMore: true, cursor: String(start + limit) };
  };
  const store = createBlobStore(config, { listImpl, getImpl: async () => null, deleteImpl: async () => {}, putImpl: async () => {} });
  const blobs = await store.listPrefix("staging/j3w1ctl/", { maximumItems: 1_200 });
  assert.equal(blobs.length, 1_200);
  assert.deepEqual(calls.map(({ limit }) => limit), [1_000, 200]);
  assert.equal(calls.every(({ token }) => token === config.blobToken), true);
});

test("private Blob probe reads back and removes its exact disposable object", async () => {
  const removed = [];
  const bytes = Buffer.from("probe");
  const store = createBlobStore(config, {
    listImpl: async () => ({ blobs: [], hasMore: false }),
    putImpl: async (pathname, content, options) => {
      assert.equal(pathname, "staging/j3w1ctl/preflight/probe.txt");
      assert.equal(Buffer.from(content).equals(bytes), true);
      assert.equal(options.access, "private");
    },
    getImpl: async () => ({ statusCode: 200, stream: new Blob([bytes]).stream(), blob: { pathname: "staging/j3w1ctl/preflight/probe.txt", contentType: "text/plain", size: bytes.length } }),
    deleteImpl: async (paths) => { removed.push(...paths); },
  });
  assert.equal(await store.probe("staging/j3w1ctl/preflight/probe.txt", bytes), true);
  assert.deepEqual(removed, ["staging/j3w1ctl/preflight/probe.txt"]);
});
