/* Semantics of the Neon-backed store.

   These run against a real Postgres, because the interesting parts — NX against
   an expired row, expiry enforced in the read path, keyset pagination — live in
   SQL, and a hand-written fake would only assert that the fake behaves like the
   fake. Set DATABASE_URL (a Neon branch is ideal) to exercise them; without one
   the suite reports them as skipped rather than passing vacuously. */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createPostgresStore } from "../src/store.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const options = { skip: databaseUrl ? false : "DATABASE_URL is not set" };
const store = databaseUrl ? createPostgresStore({ databaseUrl }) : null;
const scoped = () => `test:${randomUUID()}`;

test("the schema applies idempotently", options, async () => {
  await store.migrate();
  await store.migrate();
  assert.equal(await store.ping(), "PONG");
});

test("values round-trip and expiry is enforced on read", options, async () => {
  await store.migrate();
  const key = scoped();
  await store.set(key, { hello: "world", nested: [1, 2] }, 60);
  assert.deepEqual(await store.get(key), { hello: "world", nested: [1, 2] });

  /* A lapsed entry must be unreadable immediately, not merely swept later. */
  const expiring = scoped();
  await store.set(expiring, { gone: true }, -1);
  assert.equal(await store.get(expiring), null);

  assert.equal(await store.delete(key), 1);
  assert.equal(await store.get(key), null);
});

test("setIfAbsent holds against a live entry and yields to an expired one", options, async () => {
  await store.migrate();
  const key = scoped();

  assert.equal(await store.setIfAbsent(key, { first: true }, 60), true);
  assert.equal(await store.setIfAbsent(key, { second: true }, 60), false);
  assert.deepEqual(await store.get(key), { first: true }, "the winner is not overwritten");

  /* An expired row is absent as far as the caller is concerned, so the next
     claim must succeed — this is what makes session and batch ids reusable. */
  const lapsed = scoped();
  await store.set(lapsed, { stale: true }, -1);
  assert.equal(await store.setIfAbsent(lapsed, { fresh: true }, 60), true);
  assert.deepEqual(await store.get(lapsed), { fresh: true });

  await store.delete(key, lapsed);
});

test("delete reports how many rows it actually removed", options, async () => {
  await store.migrate();
  const [a, b] = [scoped(), scoped()];
  await store.set(a, { a: 1 }, 60);
  assert.equal(await store.delete(a, b), 1, "absent keys are not counted");
  assert.equal(await store.delete(), 0, "no keys is not an error");
});

test("scan paginates by key, filters by pattern, and skips expired rows", options, async () => {
  await store.migrate();
  const prefix = `scan:${randomUUID()}`;
  const keys = [1, 2, 3].map((n) => `${prefix}:${n}`);
  for (const key of keys) await store.set(key, { key }, 60);
  const expired = `${prefix}:4`;
  await store.set(expired, { key: expired }, -1);

  const [firstCursor, firstPage] = await store.scan("0", { match: `${prefix}:*`, count: 2 });
  assert.equal(firstPage.length, 2);
  assert.notEqual(firstCursor, "0", "a full page means there may be more");

  const [nextCursor, secondPage] = await store.scan(firstCursor, { match: `${prefix}:*`, count: 2 });
  assert.equal(nextCursor, "0", "a short page ends the walk");
  assert.deepEqual([...firstPage, ...secondPage].sort(), [...keys].sort(), "expired rows never appear");

  await store.delete(...keys, expired);
});

test("a store without a connection string fails closed rather than pretending", async () => {
  const unavailable = createPostgresStore({ databaseUrl: "" });
  await assert.rejects(() => unavailable.get("anything"), (error) => error.code === "session_store_unavailable");
  await assert.rejects(() => unavailable.ping(), (error) => error.code === "session_store_unavailable");
});
