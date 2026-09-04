import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { createBlobStore } from "../src/blob-store.js";
import {
  J3W1CTL_API_PROTOCOL,
  PRODUCTION_REQUIRED_NAMES,
  PRODUCTION_SECRET_NAMES,
  TARGET_BRANCH,
  TARGET_OWNER,
  TARGET_REPOSITORY,
} from "../src/constants.js";
import { loadConfig } from "../src/config.js";
import { createRedisStore } from "../src/store.js";

const execute = promisify(execFile);
const serviceRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(serviceRoot, "../..");
const jsonOutput = process.argv.includes("--json");
const stagedPhase = process.argv.includes("--phase=staged");
const results = [];
const record = (name, status, detail) => results.push({ name, status, detail });
const pass = (name, detail) => record(name, "PASS", detail);
const fail = (name, detail) => record(name, "FAIL", detail);
const skip = (name, detail) => record(name, "SKIP", detail);

const read = (relative) => fs.readFile(path.join(repoRoot, relative), "utf8");
const config = loadConfig(process.env);

if (process.versions.node.split(".")[0] === "24") pass("runtime.node", `Node ${process.versions.node}`);
else fail("runtime.node", `Node 24.x is required; found ${process.versions.node}`);

const packageJson = JSON.parse(await fs.readFile(path.join(serviceRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(await fs.readFile(path.join(serviceRoot, "package-lock.json"), "utf8"));
const vercelConfig = JSON.parse(await fs.readFile(path.join(serviceRoot, "vercel.json"), "utf8"));
const lockedRoot = packageLock.packages?.[""] ?? {};
const dependencyMatch = JSON.stringify(packageJson.dependencies ?? {}) === JSON.stringify(lockedRoot.dependencies ?? {})
  && JSON.stringify(packageJson.devDependencies ?? {}) === JSON.stringify(lockedRoot.devDependencies ?? {});
dependencyMatch ? pass("package.lock", "package.json dependency maps match package-lock.json") : fail("package.lock", "package-lock.json is inconsistent");
packageJson.engines?.node === "24.x" && packageJson.dependencies?.fastify && !packageJson.dependencies?.next
  ? pass("runtime.fastify", "Node 24 Fastify runtime without Next.js")
  : fail("runtime.fastify", "The service runtime contract is not Node 24/Fastify-only");
vercelConfig.git?.deploymentEnabled === false
  ? pass("vercel.git-deployment", "git.deploymentEnabled=false")
  : fail("vercel.git-deployment", "automatic Git deployments are not disabled");
vercelConfig.crons?.some(({ path: route }) => route === "/api/internal/cleanup-staging")
  ? pass("vercel.cleanup-cron", "bounded staging cleanup route is scheduled")
  : fail("vercel.cleanup-cron", "the staging cleanup schedule is missing");

if (TARGET_OWNER === "j3w1" && TARGET_REPOSITORY === "j3w1.github.io" && TARGET_BRANCH === "main") pass("target.fixed", "j3w1/j3w1.github.io@main");
else fail("target.fixed", "The source constants do not identify the approved target");

const runtimeSources = await Promise.all([
  "services/j3w1ctl-auth/src/config.js",
  "services/j3w1ctl-auth/src/github.js",
  "services/j3w1ctl-auth/src/repository.js",
  "admin/j3w1ctl.js",
  "admin/j3w1ctl-core.js",
].map(read));
const obsoleteBranch = `cms-${"sandbox"}`;
runtimeSources.some((source) => source.includes(obsoleteBranch))
  ? fail("target.obsolete-branch", "An active runtime source still references the retired branch")
  : pass("target.obsolete-branch", "No active runtime source references the retired branch");
const configSource = runtimeSources[0];
/environment\.GITHUB_(?:OWNER|REPO|BRANCH)/.test(configSource)
  ? fail("target.dynamic-input", "Runtime target selection is environment-driven")
  : pass("target.dynamic-input", "No owner/repository/branch environment input is consumed");

const clientCore = await import(pathToFileURL(path.join(repoRoot, "admin/j3w1ctl-core.js")));
clientCore.J3W1CTL_SUPPORTED_PROTOCOLS.includes(J3W1CTL_API_PROTOCOL)
  ? pass("protocol.compatibility", `client supports API protocol ${J3W1CTL_API_PROTOCOL}`)
  : fail("protocol.compatibility", "Client and backend protocols differ");

const environmentNames = Object.keys(process.env).sort();
if (config.production) {
  const missing = PRODUCTION_REQUIRED_NAMES.filter((name) => !environmentNames.includes(name));
  missing.length ? fail("environment.production", `missing names: ${missing.join(", ")}`) : pass("environment.production", "all required variable names are present");
} else {
  skip("environment.production", "not running under VERCEL_ENV=production");
}
if (config.preview) {
  config.previewViolations.length ? fail("environment.preview", `forbidden names present: ${config.previewViolations.join(", ")}`) : pass("environment.preview", "production secrets are absent");
} else {
  skip("environment.preview", "not running under VERCEL_ENV=preview");
}
record("environment.inventory", "PASS", [...new Set([...PRODUCTION_REQUIRED_NAMES, ...PRODUCTION_SECRET_NAMES])].map((name) => ({ name, present: environmentNames.includes(name) })));

const adminConfig = await read("admin/config.js");
if (adminConfig.includes("ondigitalocean.app")) {
  stagedPhase
    ? pass("cutover.api-origin", "pre-commitment Pages client still uses the current DigitalOcean origin")
    : fail("cutover.api-origin", "final cutover gate: admin/config.js still contains the pre-cutover DigitalOcean origin");
} else pass("cutover.api-origin", "admin/config.js contains no DigitalOcean API origin");

const tracked = (await execute("git", ["ls-files", "-z"], { cwd: repoRoot })).stdout.split("\0").filter(Boolean);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{80,}\r?\n-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bvercel_blob_rw_[A-Za-z0-9_-]{20,}\b/,
  /\b(?:eyJ[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}\b/,
];
const textExtensions = new Set([".js", ".mjs", ".json", ".md", ".html", ".css", ".yaml", ".yml", ".txt", ""]);
let secretMatch;
for (const relative of tracked) {
  if (!textExtensions.has(path.extname(relative).toLowerCase())) continue;
  const source = await fs.readFile(path.join(repoRoot, relative), "utf8").catch(() => "");
  if (secretPatterns.some((pattern) => pattern.test(source))) { secretMatch = relative; break; }
}
secretMatch ? fail("security.tracked-secrets", `credential-shaped material found in ${secretMatch}`) : pass("security.tracked-secrets", "no tracked credential-shaped material found");

if (config.redisUrl && config.redisToken) {
  const store = createRedisStore(config);
  const key = `preflight:v1:${randomBytes(16).toString("hex")}`;
  try {
    await store.set(key, { probe: true }, 30);
    const value = await store.get(key);
    await store.delete(key);
    value?.probe === true ? pass("redis.connectivity", "disposable TTL probe created, read, and removed") : fail("redis.connectivity", "probe readback differed");
  } catch (error) {
    fail("redis.connectivity", error.code ?? "probe failed");
  }
} else skip("redis.connectivity", "credential names are unavailable in this environment");

if (config.blobToken) {
  const pathname = `staging/j3w1ctl/preflight/${randomBytes(16).toString("hex")}.txt`;
  try {
    const verified = await createBlobStore(config).probe(pathname, Buffer.from("j3w1ctl-preflight", "utf8"));
    verified ? pass("blob.connectivity", "private disposable object created, read, and removed") : fail("blob.connectivity", "private probe readback differed");
  } catch (error) {
    fail("blob.connectivity", error.code ?? "probe failed");
  }
} else skip("blob.connectivity", "BLOB_READ_WRITE_TOKEN is unavailable in this environment");

const localProjectFile = path.join(serviceRoot, ".vercel/project.json");
try {
  const project = JSON.parse(await fs.readFile(localProjectFile, "utf8"));
  project.projectId && project.orgId ? pass("vercel.link", { projectId: project.projectId, orgId: project.orgId, rootDirectory: "services/j3w1ctl-auth" }) : fail("vercel.link", "linked project identifiers are incomplete");
} catch {
  skip("vercel.link", "local project link is unavailable; no link was created");
}
skip("vercel.provider-controls", "WAF, protection, spend, Git settings, domains, and storage identities require authenticated provider readback");
skip("github.provider-controls", "App installation/permissions and main ruleset require authenticated provider readback");

const counts = Object.fromEntries(["PASS", "FAIL", "SKIP"].map((status) => [status.toLowerCase(), results.filter((item) => item.status === status).length]));
if (jsonOutput) console.log(JSON.stringify({ schemaVersion: 1, zeroMutation: true, counts, results }, null, 2));
else {
  for (const result of results) console.log(`${result.status.padEnd(4)} ${result.name}: ${typeof result.detail === "string" ? result.detail : JSON.stringify(result.detail)}`);
  console.log(`Summary: ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped.`);
}
if (counts.fail) process.exitCode = 1;
