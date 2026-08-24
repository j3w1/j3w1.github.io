import assert from "node:assert/strict";
import test from "node:test";
import { createSessionManager } from "../src/session.js";

const config = { sessionSecret: "a sufficiently long test-only session secret" };

test("CMS sessions expire and logout revokes their JTI", async () => {
  let current = 1_000;
  const sessions = createSessionManager(config, { now: () => current });
  const issued = await sessions.issue({ id: 42, login: "j3w1" });
  assert.equal((await sessions.verify(issued.token)).login, "j3w1");
  sessions.revoke(await sessions.verify(issued.token));
  await assert.rejects(() => sessions.verify(issued.token), /expired/i);
  const secondManager = createSessionManager(config, { now: () => 1_000 });
  const second = await secondManager.issue({ id: 42, login: "j3w1" });
  current += 3_601;
  await assert.rejects(() => sessions.verify(second.token), /invalid or expired/i);
});

test("OAuth state is encrypted, channel-bound, and expires", async () => {
  let current = 2_000;
  const sessions = createSessionManager(config, { now: () => current });
  const sealed = await sessions.sealOAuth({ state: "state", verifier: "verifier", channel: "channel" });
  assert.equal(sealed.includes("verifier"), false);
  assert.deepEqual(await sessions.openOAuth(sealed), { state: "state", verifier: "verifier", channel: "channel", iat: 2000, exp: 2600, aud: "j3w1ctl-oauth-state" });
  current = 2_601;
  await assert.rejects(() => sessions.openOAuth(sealed), /invalid or expired/i);
});
