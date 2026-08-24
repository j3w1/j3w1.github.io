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
  const configSource = await fs.readFile(path.join(repoRoot, "admin", "config.js"), "utf8");
  const configMatch = configSource.match(/^\s*window\.J3W1CTL_CONFIG\s*=\s*Object\.freeze\(\{\s*apiBaseUrl:\s*"([^"]*)",\s*\}\);\s*$/s);
  assert.ok(configMatch, "admin/config.js must contain only the public API base URL");
  if (configMatch[1]) {
    const apiBaseUrl = new URL(configMatch[1]);
    assert.equal(apiBaseUrl.protocol, "https:");
    assert.equal(apiBaseUrl.username, "");
    assert.equal(apiBaseUrl.password, "");
    assert.equal(apiBaseUrl.pathname, "/");
    assert.equal(apiBaseUrl.search, "");
    assert.equal(apiBaseUrl.hash, "");
  }
});

test("browser OAuth handoff keeps exact origin, source, type, and channel checks", async () => {
  const source = await fs.readFile(path.join(repoRoot, "admin", "j3w1ctl.js"), "utf8");
  assert.match(source, /event\.origin !== this\.apiBase/);
  assert.match(source, /event\.source !== this\.popup/);
  assert.match(source, /event\.data\?\.channel !== channel/);
  assert.match(source, /\["j3w1ctl:auth-success", "j3w1ctl:auth-error"\]\.includes\(event\.data\?\.type\)/);
  assert.match(source, /sessionStorage\.setItem\(TOKEN_KEY, this\.token\)/);
});
