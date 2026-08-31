import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { PRODUCTION_SECRET_NAMES } from "../src/constants.js";

const execute = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const script = path.join(repoRoot, "services", "j3w1ctl-auth", "bin", "deploy-preflight.mjs");

test("deploy preflight reports strict JSON and makes no durable workspace or provider-control mutation", async () => {
  const environment = { ...process.env };
  for (const name of [...PRODUCTION_SECRET_NAMES, "VERCEL_ENV", "NODE_ENV"]) delete environment[name];
  const before = (await execute("git", ["status", "--porcelain=v1", "-z"], { cwd: repoRoot })).stdout;
  let stdout;
  try {
    stdout = (await execute(process.execPath, [script, "--json"], { cwd: repoRoot, env: environment })).stdout;
  } catch (error) {
    stdout = error.stdout;
  }
  const result = JSON.parse(stdout);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.zeroMutation, true);
  assert.equal(result.results.find(({ name }) => name === "target.fixed")?.status, "PASS");
  assert.equal(result.results.find(({ name }) => name === "target.dynamic-input")?.status, "PASS");
  assert.equal(result.results.find(({ name }) => name === "runtime.fastify")?.status, "PASS");
  assert.equal(result.results.find(({ name }) => name === "vercel.git-deployment")?.status, "PASS");
  assert.equal(result.results.find(({ name }) => name === "security.tracked-secrets")?.status, "PASS");
  assert.equal(result.results.find(({ name }) => name === "vercel.provider-controls")?.status, "SKIP");
  const after = (await execute("git", ["status", "--porcelain=v1", "-z"], { cwd: repoRoot })).stdout;
  assert.equal(after, before);
});
