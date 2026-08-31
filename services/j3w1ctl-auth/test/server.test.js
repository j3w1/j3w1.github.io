import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../src/server.js";
import { testProductionEnvironment } from "./helpers.js";

const productionEnvironment = testProductionEnvironment;

test("health remains healthy while configuration is incomplete", async () => {
  const app = await buildServer({ environment: {}, githubClient: {} });
  const response = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    configured: false,
    protocolVersion: 1,
    provenance: {
      provider: "vercel",
      runtime: "node",
      environment: "development",
      protocolVersion: 1,
      repository: { owner: "j3w1", name: "j3w1.github.io", branch: "main" },
    },
  });
  await app.close();
});

test("API errors have stable shape and all API content routes require bearer auth", async () => {
  const app = await buildServer({ environment: productionEnvironment, sessionManager: { verify: async () => { throw new Error("must not run"); } }, githubClient: {} });
  const response = await app.inject({ method: "GET", url: "/api/content/writing" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "unauthorized");
  assert.equal(typeof response.json().error.requestId, "string");
  await app.close();
});

test("unknown routes are sanitized", async () => {
  const app = await buildServer({ environment: {}, githubClient: {} });
  const response = await app.inject({ method: "GET", url: "/not-a-route?code=secret" });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(Object.keys(response.json().error), ["code", "message", "requestId"]);
  assert.equal(response.body.includes("secret"), false);
  await app.close();
});

test("mutations enforce exact origin and publish through one repository commit", async () => {
  const calls = [];
  const app = await buildServer({
    environment: productionEnvironment,
    sessionManager: { verify: async () => ({ sub: "42", login: "j3w1", exp: 999999, jti: "jti" }), revoke() {} },
    githubClient: {
      getSnapshot: async () => ({ headSha: "2".repeat(40), files: new Map() }),
      createCommit: async (value) => { calls.push(value); return { commitSha: "3".repeat(40) }; },
    },
  });
  const payload = { metadata: { title: "Entry", slug: "entry", date: "2026-08-24", summary: "Summary", tags: [] }, body: "Body" };
  const denied = await app.inject({ method: "POST", url: "/api/content/writing", headers: { authorization: "Bearer token", origin: "https://evil.example", "if-none-match": "*" }, payload });
  assert.equal(denied.statusCode, 403);
  assert.equal(calls.length, 0);
  const accepted = await app.inject({ method: "POST", url: "/api/content/writing", headers: { authorization: "Bearer token", origin: "https://j3w1.github.io", "if-none-match": "*" }, payload });
  assert.equal(accepted.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].expectedHeadOid, "2".repeat(40));
  await app.close();
});

test("authenticated session reports only the fixed publication target and protocol", async () => {
  const app = await buildServer({
    environment: { ...productionEnvironment, GITHUB_OWNER: "attacker", GITHUB_REPO: "other", GITHUB_BRANCH: "other" },
    sessionManager: { verify: async () => ({ sub: "42", login: "j3w1", exp: 999999, jti: "jti" }) },
    githubClient: {},
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/session?branch=main",
    headers: { authorization: "Bearer token" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().repository, { owner: "j3w1", name: "j3w1.github.io", branch: "main" });
  assert.equal(response.json().protocolVersion, 1);
  assert.equal(response.json().provenance.provider, "vercel");
  await app.close();
});

test("Preview remains zero-write even when test dependencies attempt to supply an authenticated session", async () => {
  let writes = 0;
  const app = await buildServer({
    environment: { ...productionEnvironment, VERCEL_ENV: "preview" },
    sessionManager: { verify: async () => ({ sub: "42", login: "j3w1", exp: 999999, sessionId: "digest" }) },
    githubClient: {
      getSnapshot: async () => ({ headSha: "2".repeat(40), files: new Map() }),
      createCommit: async () => { writes += 1; return { commitSha: "3".repeat(40) }; },
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/content/writing",
    headers: { authorization: `Bearer ${"t".repeat(43)}`, origin: "https://j3w1.github.io", "if-none-match": "*" },
    payload: { metadata: { title: "Entry", slug: "entry", date: "2026-08-31", summary: "Summary", tags: [] }, body: "Body" },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(writes, 0);
  await app.close();
});

test("OAuth start uses PKCE and a host-only secure state cookie", async () => {
  const app = await buildServer({ environment: productionEnvironment, githubClient: {} });
  const channel = "a".repeat(43);
  const response = await app.inject({ method: "GET", url: `/auth/github/start?channel=${channel}` });
  assert.equal(response.statusCode, 302);
  const location = new URL(response.headers.location);
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.match(location.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(location.searchParams.get("state").endsWith(`.${channel}`), true);
  assert.match(response.headers["set-cookie"], /^__Host-j3w1ctl-oauth=.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
  assert.equal(response.headers["cross-origin-opener-policy"], undefined);
  assert.equal(response.headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  await app.close();
});

test("OAuth callback errors notify only the exact configured origin and issue no session", async () => {
  const app = await buildServer({ environment: productionEnvironment, githubClient: {} });
  const channel = "b".repeat(43);
  const response = await app.inject({ method: "GET", url: `/auth/github/callback?state=missing.${channel}&code=unused` });
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers["cross-origin-opener-policy"], undefined);
  assert.match(response.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.match(response.body, /j3w1ctl:auth-error/);
  assert.match(response.body, /https:\/\/j3w1\.github\.io/);
  assert.equal(response.body.includes("j3w1ctl:auth-success"), false);
  await app.close();
});

test("OAuth callback verifies the exact owner, issues an opaque session, and always revokes the temporary GitHub token", async () => {
  const channel = "c".repeat(43);
  const state = `state.${channel}`;
  const calls = { issue: 0, revoke: [] };
  const sessionManager = {
    randomToken: () => "n".repeat(43),
    openOAuth: async () => ({ state, verifier: "pkce-verifier", channel }),
    issue: async (user) => { calls.issue += 1; assert.equal(user.id, 42); return { token: "s".repeat(43), expiresAt: 1234 }; },
  };
  const githubClient = {
    exchangeOAuthCode: async ({ code, verifier }) => {
      assert.deepEqual({ code, verifier }, { code: "temporary-code", verifier: "pkce-verifier" });
      return { access_token: "temporary-user-token" };
    },
    getUser: async (token) => { assert.equal(token, "temporary-user-token"); return { id: 42, login: "J3W1" }; },
    revokeUserToken: async (token) => { calls.revoke.push(token); },
  };
  const app = await buildServer({ environment: productionEnvironment, sessionManager, githubClient });
  const response = await app.inject({
    method: "GET",
    url: `/auth/github/callback?state=${state}&code=temporary-code`,
    headers: { cookie: `__Host-j3w1ctl-oauth=sealed-state` },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(calls.issue, 1);
  assert.deepEqual(calls.revoke, ["temporary-user-token"]);
  assert.match(response.body, /j3w1ctl:auth-success/);
  assert.equal(response.body.includes("temporary-user-token"), false);
  await app.close();
});

test("upload batch control routes require owner session and exact Origin", async () => {
  const calls = [];
  const uploadBatchManager = {
    create: async (value) => { calls.push(["create", value]); return { id: "b".repeat(32) }; },
    finalize: async (value) => { calls.push(["finalize", value]); return { commitSha: "4".repeat(40) }; },
    cancel: async (value) => { calls.push(["cancel", value]); },
    cleanup: async () => ({ scanned: 0, deleted: 0 }),
  };
  const session = { sub: "42", login: "j3w1", exp: 999999, sessionId: "digest" };
  const app = await buildServer({
    environment: productionEnvironment,
    sessionManager: { verify: async () => session, revoke: async () => {} },
    githubClient: {},
    uploadBatchManager,
  });
  const headers = { authorization: `Bearer ${"t".repeat(43)}`, origin: "https://j3w1.github.io", "if-none-match": "*" };
  const body = { collection: "photography", slug: "fixture", action: "create", imageIds: ["image-01"] };
  const denied = await app.inject({ method: "POST", url: "/api/photography/upload-batches", headers: { ...headers, origin: "https://evil.example" }, payload: body });
  assert.equal(denied.statusCode, 403);
  assert.equal(calls.length, 0);
  const created = await app.inject({ method: "POST", url: "/api/photography/upload-batches", headers, payload: body });
  assert.equal(created.statusCode, 201);
  assert.equal(calls[0][0], "create");
  assert.equal(calls[0][1].session, session);
  assert.equal(calls[0][1].ifNoneMatch, "*");

  const finalized = await app.inject({ method: "POST", url: `/api/photography/upload-batches/${"b".repeat(32)}/finalize`, headers, payload: { metadata: { slug: "fixture" } } });
  assert.equal(finalized.statusCode, 200);
  assert.equal(calls[1][0], "finalize");
  assert.equal(typeof calls[1][1].verifySession, "function");
  await app.close();
});
