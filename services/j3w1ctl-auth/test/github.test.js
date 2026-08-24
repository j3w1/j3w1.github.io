import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createGitHubClient } from "../src/github.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config = {
  githubPrivateKeyBase64: Buffer.from(privateKey.export({ type: "pkcs1", format: "pem" })).toString("base64"),
  githubAppId: "123",
  githubClientId: "client",
  githubClientSecret: "secret",
  callbackUrl: "https://cms.example/auth/github/callback",
  githubOwner: "j3w1",
  githubRepo: "j3w1.github.io",
  githubBranch: "cms-sandbox",
  githubApiVersion: "2026-03-10",
  repositoryNameWithOwner: "j3w1/j3w1.github.io",
};

const response = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("installation tokens are opaque and GraphQL commit verifies returned ref", async () => {
  const calls = [];
  const token = "future opaque installation credential format";
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/installation")) return response({ id: 55 });
    if (String(url).endsWith("/access_tokens")) return response({ token, expires_at: "2030-01-01T00:00:00Z" });
    return response({ data: { createCommitOnBranch: { commit: { oid: "3".repeat(40), url: "https://github.test/commit" }, ref: { target: { oid: "3".repeat(40) } } } } });
  };
  const github = createGitHubClient(config, { fetchImpl, now: () => 1_000 });
  const result = await github.createCommit({ expectedHeadOid: "2".repeat(40), headline: "cms: create writing/entry", additions: [{ path: "content/writing/entry.md", content: Buffer.from("source") }], deletions: [] });
  assert.equal(result.commitSha, "3".repeat(40));
  const tokenCall = calls.find(({ url }) => url.endsWith("/access_tokens"));
  assert.deepEqual(JSON.parse(tokenCall.options.body), { repositories: ["j3w1.github.io"], permissions: { contents: "write" } });
  const graph = calls.find(({ url }) => url.endsWith("/graphql"));
  assert.equal(graph.options.headers.Authorization, `Bearer ${token}`);
  const input = JSON.parse(graph.options.body).variables.input;
  assert.equal(input.expectedHeadOid, "2".repeat(40));
  assert.equal(input.branch.branchName, "cms-sandbox");
  assert.equal(Buffer.from(input.fileChanges.additions[0].contents, "base64").toString(), "source");
});

test("GraphQL expected-head errors map to a conflict without retry", async () => {
  let graphqlCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/installation")) return response({ id: 55 });
    if (String(url).endsWith("/access_tokens")) return response({ token: "opaque", expires_at: "2030-01-01T00:00:00Z" });
    graphqlCalls += 1;
    return response({ errors: [{ message: "expectedHeadOid does not match the branch head" }] });
  };
  const github = createGitHubClient(config, { fetchImpl, now: () => 1_000 });
  await assert.rejects(() => github.createCommit({ expectedHeadOid: "2".repeat(40), headline: "test", additions: [{ path: "x", content: Buffer.from("x") }], deletions: [] }), /changed/i);
  assert.equal(graphqlCalls, 1);
});

test("network failures are sanitized as GitHub availability errors", async () => {
  const github = createGitHubClient(config, { fetchImpl: async () => { throw new Error("token=should-not-leak"); }, now: () => 1_000 });
  await assert.rejects(() => github.getSnapshot(), (error) => error.code === "github_error" && !error.message.includes("token="));
});

