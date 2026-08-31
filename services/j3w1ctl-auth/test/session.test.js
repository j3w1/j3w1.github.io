import assert from "node:assert/strict";
import test from "node:test";
import { J3W1CTL_API_PROTOCOL, SESSION_TTL_SECONDS } from "../src/constants.js";
import { createSessionManager, digestSessionToken } from "../src/session.js";
import { createMemoryStore } from "./helpers.js";

const config = {
  sessionSecret: "a sufficiently long test-only session secret",
  allowedGithubUserId: "42",
  allowedGithubLogin: "j3w1",
};

test("opaque sessions use digest-keyed shared storage with a 60-minute TTL", async () => {
  const store = createMemoryStore({ now: () => 1_000 });
  const sessions = createSessionManager(config, { now: () => 1_000, store });
  const first = await sessions.issue({ id: 42, login: "J3W1", access_token: "must-not-persist" });
  const second = await sessions.issue({ id: 42, login: "j3w1" });
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.token.includes("."), false);
  const key = `sess:v1:${digestSessionToken(first.token)}`;
  assert.equal(store.entries.has(key), true);
  const stored = store.entries.get(key);
  assert.equal(stored.expiresAt, 1_000 + SESSION_TTL_SECONDS);
  assert.deepEqual(stored.value, {
    schemaVersion: 1,
    ownerUserId: "42",
    ownerLogin: "j3w1",
    issuedAt: 1_000,
    expiresAt: 4_600,
    protocolVersion: J3W1CTL_API_PROTOCOL,
  });
  assert.equal(JSON.stringify([...store.entries]).includes(first.token), false);
  assert.equal(JSON.stringify([...store.entries]).includes("must-not-persist"), false);
});

test("session issue rejects an owner mismatch before writing Redis", async () => {
  const store = createMemoryStore();
  const sessions = createSessionManager(config, { store, now: () => 1_000 });
  await assert.rejects(() => sessions.issue({ id: 7, login: "other" }), (error) => error.code === "unauthorized");
  assert.equal(store.entries.size, 0);
});

test("sessions verify and logout across independent instances", async () => {
  const store = createMemoryStore({ now: () => 1_000 });
  const instanceA = createSessionManager(config, { now: () => 1_000, store });
  const instanceB = createSessionManager(config, { now: () => 1_000, store });
  const issued = await instanceA.issue({ id: 42, login: "j3w1" });
  assert.equal((await instanceB.verify(issued.token)).login, "j3w1");
  await instanceB.revoke(issued.token);
  await assert.rejects(() => instanceA.verify(issued.token), /invalid or expired/i);
});

test("sessions fail closed for expiry, malformed/unknown tokens, owner/protocol drift, and Redis outage", async () => {
  let current = 2_000;
  const store = createMemoryStore({ now: () => current });
  const sessions = createSessionManager(config, { now: () => current, store });
  const issued = await sessions.issue({ id: 42, login: "j3w1" });
  await assert.rejects(() => sessions.verify("not-a-token"), /invalid or expired/i);
  await assert.rejects(() => sessions.verify("a".repeat(43)), /invalid or expired/i);
  const key = `sess:v1:${digestSessionToken(issued.token)}`;
  store.entries.get(key).value.ownerUserId = "7";
  await assert.rejects(() => sessions.verify(issued.token), /invalid or expired/i);
  store.entries.get(key).value.ownerUserId = "42";
  store.entries.get(key).value.protocolVersion = 999;
  await assert.rejects(() => sessions.verify(issued.token), /invalid or expired/i);
  store.entries.get(key).value.protocolVersion = J3W1CTL_API_PROTOCOL;
  current += SESSION_TTL_SECONDS + 1;
  await assert.rejects(() => sessions.verify(issued.token), /invalid or expired/i);
  const unavailable = createSessionManager(config, { store: createMemoryStore({ unavailable: true }) });
  await assert.rejects(() => unavailable.issue({ id: 42, login: "j3w1" }), (error) => error.code === "session_store_unavailable");
});

test("OAuth state is encrypted, channel-bound, and expires", async () => {
  let current = 2_000;
  const sessions = createSessionManager(config, { now: () => current, store: createMemoryStore({ now: () => current }) });
  const sealed = await sessions.sealOAuth({ state: "state", verifier: "verifier", channel: "channel" });
  assert.equal(sealed.includes("verifier"), false);
  assert.deepEqual(await sessions.openOAuth(sealed), { state: "state", verifier: "verifier", channel: "channel", iat: 2000, exp: 2600, aud: "j3w1ctl-oauth-state" });
  current = 2_601;
  await assert.rejects(() => sessions.openOAuth(sealed), /invalid or expired/i);
});
