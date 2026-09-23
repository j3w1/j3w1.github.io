/* Defined once, mirrored where an import is impossible.

   A few values have to exist in more than one file because the files cannot
   import each other: 404.html's rescue script runs before any module loads,
   the backend service deploys on its own and must never reach into assets/,
   the browser renderer cannot import the service, and each package pins its
   own Playwright. Each copy points at its original; these tests hold them
   equal so a change to one fails here rather than in production. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { COLLECTIONS } from "../assets/js/content-index.js";
import { WORKSPACES } from "../assets/js/route.js";
import { COLLECTIONS as SERVICE_COLLECTIONS, SLUG_PATTERN } from "../services/j3w1ctl-auth/src/content.js";
import { SAFE_LINK_PROTOCOLS } from "../services/j3w1ctl-auth/src/html-renderer.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFile(path.join(repoRoot, ...parts), "utf8");
const arrayLiteral = (source, pattern, label) => {
  const match = source.match(pattern);
  assert.ok(match, `${label}: the mirrored literal was not found`);
  return JSON.parse(match[1]);
};

test("404.html mirrors the workspace list and the slug pattern", async () => {
  const notFound = await read("404.html");
  assert.deepEqual(arrayLiteral(notFound, /const workspaces = (\[[^\]]*\]);/, "404.html workspaces"), [...WORKSPACES]);
  const slug = notFound.match(/\/(\^[^/]*\$)\/\.test\(slug\)/)?.[1];
  assert.equal(slug, SLUG_PATTERN.source, "404.html's slug pattern drifted from the content validator");
});

test("the workspace sections in index.html follow the route order", async () => {
  const html = await read("index.html");
  const layers = [...html.matchAll(/data-wm-layer="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(layers, [...WORKSPACES]);
});

test("the site, the service and j3w1ctl agree on the collections", async () => {
  assert.deepEqual([...SERVICE_COLLECTIONS], [...COLLECTIONS]);
  const admin = await read("admin", "j3w1ctl.js");
  assert.deepEqual(arrayLiteral(admin, /const COLLECTIONS = (\[[^\]]*\]);/, "admin/j3w1ctl.js"), [...COLLECTIONS]);
});

test("both content renderers allow the same link schemes", async () => {
  const browser = await read("assets", "js", "content-renderer.js");
  assert.deepEqual(arrayLiteral(browser, /if \(!(\[[^\]]*\])\.includes\(url\.protocol\)\)/, "content-renderer.js"), [...SAFE_LINK_PROTOCOLS]);
});

test("both packages pin the same Playwright build", async () => {
  const lock = async (...parts) => JSON.parse(await read(...parts));
  const root = await lock("package-lock.json");
  const service = await lock("services", "j3w1ctl-auth", "package-lock.json");
  const version = (file) => file.packages["node_modules/playwright-core"]?.version;
  assert.ok(version(root), "the root lockfile resolves playwright-core");
  assert.equal(version(service), version(root), "CI installs one Chromium; both suites must drive the same build");
  const range = (file) => file.packages[""].devDependencies["@playwright/test"];
  assert.equal(range(service), range(root));
});
