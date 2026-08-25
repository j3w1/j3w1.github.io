import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../src/server.js";

const productionEnvironment = {
  NODE_ENV: "production",
  CMS_SITE_ORIGIN: "https://j3w1.github.io",
  CMS_ALLOWED_GITHUB_LOGIN: "j3w1",
  CMS_ALLOWED_GITHUB_USER_ID: "42",
  CMS_SESSION_SECRET: "a sufficiently long test-only session secret",
  GITHUB_APP_ID: "1",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "secret",
  GITHUB_PRIVATE_KEY_BASE64: "key",
  GITHUB_CALLBACK_URL: "https://cms.example/auth/github/callback",
};

test("health remains healthy while configuration is incomplete", async () => {
  const app = await buildServer({ environment: {}, githubClient: {} });
  const response = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", configured: false });
  await app.close();
});

test("API errors have stable shape and all API content routes require bearer auth", async () => {
  const app = await buildServer({ environment: {}, githubClient: {} });
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

test("authenticated session reports the server-controlled publication target", async () => {
  const app = await buildServer({
    environment: { ...productionEnvironment, GITHUB_OWNER: "j3w1", GITHUB_REPO: "j3w1.github.io", GITHUB_BRANCH: "cms-sandbox" },
    sessionManager: { verify: async () => ({ sub: "42", login: "j3w1", exp: 999999, jti: "jti" }) },
    githubClient: {},
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/session?branch=main",
    headers: { authorization: "Bearer token" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().repository, { owner: "j3w1", name: "j3w1.github.io", branch: "cms-sandbox" });
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
