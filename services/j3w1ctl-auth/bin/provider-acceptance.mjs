import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { loadConfig } from "../src/config.js";
import { createAcceptanceGitHubClient } from "../src/github.js";
import { createRepositoryService } from "../src/repository.js";

const execute = promisify(execFile);
const apply = process.argv.includes("--apply");
const json = process.argv.includes("--json");
const repo = "j3w1/j3w1.github.io";
const gh = async (args) => JSON.parse((await execute("gh", ["api", ...args], { maxBuffer: 10 * 1024 * 1024 })).stdout || "null");
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase();
const branch = `migration/j3w1ctl-vercel-acceptance-${timestamp}-${randomBytes(4).toString("hex")}`;
const writingSlug = `migration-writing-${randomBytes(4).toString("hex")}`;
const photographySlug = `migration-photography-${randomBytes(4).toString("hex")}`;
const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/v89WAAAAA==", "base64");
const replacementWebp = Buffer.from(webp);
replacementWebp[replacementWebp.length - 1] ^= 1;

if (!apply) {
  console.error("Provider acceptance is effectful and requires --apply. It creates and deletes one generated GitHub branch; it never writes main.");
  process.exit(2);
}

const config = loadConfig({ ...process.env, NODE_ENV: "production", VERCEL_ENV: "production" });
const githubNames = [
  "CMS_ALLOWED_GITHUB_LOGIN",
  "CMS_ALLOWED_GITHUB_USER_ID",
  "GITHUB_APP_ID",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_PRIVATE_KEY_BASE64",
  "GITHUB_CALLBACK_URL",
  "GITHUB_API_VERSION",
];
const missing = githubNames.filter((name) => !String(process.env[name] ?? "").trim());
if (missing.length) throw new Error(`Provider acceptance requires environment variable names: ${missing.join(", ")}`);

const base = await gh([`repos/${repo}/git/ref/heads/main`]);
const baseSha = base?.object?.sha;
if (!/^[0-9a-f]{40}$/i.test(baseSha ?? "")) throw new Error("The exact main head could not be read.");

const evidence = {
  schemaVersion: 1,
  repository: repo,
  branch,
  baseSha,
  writeAttempts: 0,
  successfulCommits: [],
  staleConflicts: [],
  actors: [],
  comparison: null,
  finalTreeMatchesBase: false,
  branchDeleted: false,
};
let branchCreated = false;

const assertConflict = async (label, operation) => {
  const before = evidence.writeAttempts;
  try {
    await operation();
  } catch (error) {
    if (error?.code !== "content_conflict") throw error;
    if (evidence.writeAttempts !== before) throw new Error(`${label} reached the provider write path.`);
    evidence.staleConflicts.push(label);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded.`);
};

try {
  await gh(["-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${baseSha}`]);
  branchCreated = true;

  const rawClient = createAcceptanceGitHubClient(config, branch);
  const client = {
    ...rawClient,
    createCommit: async (input) => {
      evidence.writeAttempts += 1;
      const result = await rawClient.createCommit(input);
      evidence.successfulCommits.push({ sha: result.commitSha, expectedHeadOid: input.expectedHeadOid, additions: input.additions.length, deletions: input.deletions.length });
      return result;
    },
  };
  const repository = createRepositoryService(client);

  await repository.publish({
    action: "create",
    collection: "writing",
    slug: writingSlug,
    metadata: { title: "Migration acceptance writing", slug: writingSlug, date: "2026-08-31", summary: "Ephemeral provider acceptance fixture.", tags: ["test"] },
    body: "Ephemeral fixture. It must never enter main.",
    ifNoneMatch: "*",
  });
  const writingCreated = await repository.get("writing", writingSlug);
  await repository.publish({
    action: "update",
    collection: "writing",
    slug: writingSlug,
    metadata: { title: "Migration acceptance writing updated", slug: writingSlug, date: "2026-08-31", summary: "Updated ephemeral provider acceptance fixture.", tags: ["test"] },
    body: "Updated ephemeral fixture. It must never enter main.",
    ifMatch: `"${writingCreated.version}"`,
  });
  await assertConflict("writing stale update", () => repository.publish({
    action: "update",
    collection: "writing",
    slug: writingSlug,
    metadata: { title: "Stale writing", slug: writingSlug, date: "2026-08-31", summary: "Must conflict.", tags: [] },
    body: "Must conflict.",
    ifMatch: `"${writingCreated.version}"`,
  }));

  const photoMetadata = {
    title: "Migration acceptance photography",
    slug: photographySlug,
    date: "2026-08-31",
    caption: "Ephemeral provider acceptance fixture.",
    images: [{ id: "image-01", file: "image-01.webp", thumbnail: "image-01-thumb.webp", alt: "Ephemeral test image" }],
  };
  await repository.publish({
    action: "create",
    collection: "photography",
    slug: photographySlug,
    metadata: photoMetadata,
    uploads: new Map([["image-01", { full: webp, thumbnail: webp }]]),
    ifNoneMatch: "*",
  });
  const photoCreated = await repository.get("photography", photographySlug);
  await repository.publish({
    action: "update",
    collection: "photography",
    slug: photographySlug,
    metadata: { ...photoMetadata, caption: "Replacement pair accepted." },
    uploads: new Map([["image-01", { full: replacementWebp, thumbnail: replacementWebp }]]),
    ifMatch: `"${photoCreated.version}"`,
  });
  await assertConflict("photography stale update", () => repository.publish({
    action: "update",
    collection: "photography",
    slug: photographySlug,
    metadata: photoMetadata,
    uploads: new Map([["image-01", { full: webp, thumbnail: webp }]]),
    ifMatch: `"${photoCreated.version}"`,
  }));

  const photoCurrent = await repository.get("photography", photographySlug);
  await repository.publish({ action: "delete", collection: "photography", slug: photographySlug, ifMatch: `"${photoCurrent.version}"` });
  const writingCurrent = await repository.get("writing", writingSlug);
  await repository.publish({ action: "delete", collection: "writing", slug: writingSlug, ifMatch: `"${writingCurrent.version}"` });

  if (evidence.writeAttempts !== 6 || evidence.successfulCommits.length !== 6) throw new Error("Acceptance did not produce exactly six single-attempt commits.");
  for (const commit of evidence.successfulCommits) {
    const readback = await gh([`repos/${repo}/commits/${commit.sha}`]);
    evidence.actors.push({ sha: commit.sha, login: readback?.author?.login, type: readback?.author?.type });
  }
  const actorIdentities = new Set(evidence.actors.map(({ login, type }) => `${login}:${type}`));
  if (actorIdentities.size !== 1 || evidence.actors.some(({ login, type }) => !login || type !== "Bot")) {
    throw new Error("The provider commit actor was not one consistent GitHub App bot identity.");
  }
  const comparison = await gh([`repos/${repo}/compare/main...${encodeURIComponent(branch)}`]);
  evidence.comparison = { aheadBy: comparison.ahead_by, behindBy: comparison.behind_by, totalCommits: comparison.total_commits };
  if (comparison.ahead_by !== 6 || comparison.total_commits !== 6) throw new Error("Acceptance operations were not represented by exactly six commits.");
  const head = await gh([`repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`]);
  const headCommit = await gh([`repos/${repo}/git/commits/${head.object.sha}`]);
  const baseCommit = await gh([`repos/${repo}/git/commits/${baseSha}`]);
  evidence.finalTreeMatchesBase = headCommit.tree.sha === baseCommit.tree.sha;
  if (!evidence.finalTreeMatchesBase) throw new Error("The acceptance branch did not return to the exact main tree.");
} finally {
  if (branchCreated) {
    await execute("gh", ["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`]);
    try {
      await execute("gh", ["api", `repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`]);
    } catch (error) {
      if (error?.code === 1) evidence.branchDeleted = true;
      else throw error;
    }
  }
}

if (!evidence.branchDeleted) throw new Error("The ephemeral acceptance branch deletion was not proven.");
if (json) console.log(JSON.stringify(evidence, null, 2));
else {
  console.log(`PASS repository: ${evidence.repository}`);
  console.log(`PASS branch: ${evidence.branch}`);
  console.log(`PASS exact base: ${evidence.baseSha}`);
  console.log(`PASS single-attempt commits: ${evidence.successfulCommits.length}`);
  console.log(`PASS stale conflicts before write: ${evidence.staleConflicts.join(", ")}`);
  console.log(`PASS final tree equals base: ${evidence.finalTreeMatchesBase}`);
  console.log(`PASS branch deletion readback: ${evidence.branchDeleted}`);
  console.log(`PASS provider actors: ${[...new Set(evidence.actors.map(({ login }) => login).filter(Boolean))].join(", ")}`);
}
