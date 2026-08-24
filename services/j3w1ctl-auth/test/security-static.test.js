import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const filesUnder = async (directory) => {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(target));
    else result.push(target);
  }
  return result;
};

test("browser bundles, configuration, and deployment examples contain no credential material", async () => {
  const candidates = [
    ...await filesUnder(path.join(repoRoot, "admin")),
    ...await filesUnder(path.join(repoRoot, "assets", "js")),
    path.join(repoRoot, "services", "j3w1ctl-auth", ".env.example"),
    path.join(repoRoot, "services", "j3w1ctl-auth", "do-app.example.yaml"),
  ];
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\b(?:eyJ[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}\b/,
  ];
  for (const file of candidates) {
    const source = await fs.readFile(file, "utf8");
    for (const pattern of forbidden) assert.equal(pattern.test(source), false, `${path.relative(repoRoot, file)} matched ${pattern}`);
  }
  assert.match(await fs.readFile(path.join(repoRoot, "admin", "config.js"), "utf8"), /apiBaseUrl:\s*""/);
});

