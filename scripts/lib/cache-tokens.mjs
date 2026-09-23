/* The site's cache-busting scheme, in one place.

   Every asset that ships as part of the public shell — the stylesheets and
   every module under assets/js/ — shares ONE dated ?v= token that is bumped
   as a unit: pinning only boot.js would let a stale cached layout.js load
   against a fresh tree.js. A few files are versioned on their own and only
   re-published when they change: content-renderer.js, photo-viewer.js, and
   everything under admin/. Fonts are content-hashed by scripts/generate.mjs
   and never touched here.

   The page generator carries the stylesheet's token too, so the prerendered
   entry pages are busted with the shell; after a bump, `npm run generate`
   rewrites them and the service must be redeployed before the next browser
   publish. */

import { promises as fs } from "node:fs";
import path from "node:path";

export const TOKEN_PATTERN = /([A-Za-z0-9_./-]+)\?v=([A-Za-z0-9]+)/g;

/* Pages and sources, beyond the scripts under assets/js, that reference a
   shared-token asset. */
export const VERSIONED_FILES = [
  "index.html",
  "wiki/index.html",
  "admin/index.html",
  "404.html",
  "services/j3w1ctl-auth/src/site-pages.js",
];

const INDEPENDENT = /(?:^|\/)(?:content-renderer\.js|photo-viewer\.js)$|(?:^|\/)admin\/|(?:^|\/)fonts\//;

export const isSharedTarget = (target) => !INDEPENDENT.test(target);

const walk = async (directory) => {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(next));
    else if (entry.name.endsWith(".js")) result.push(next);
  }
  return result;
};

export const versionedFiles = async (repoRoot) => {
  const scripts = await walk(path.join(repoRoot, "assets", "js"));
  const listed = [];
  for (const relative of VERSIONED_FILES) {
    const absolute = path.join(repoRoot, relative);
    try {
      await fs.access(absolute);
      listed.push(absolute);
    } catch {
      /* A listed page can be absent in a partial checkout; that is not an error. */
    }
  }
  return [...listed, ...scripts].map((absolute) => path.relative(repoRoot, absolute).replaceAll("\\", "/"));
};

/* Returns { shared: Map<token, [file:target]>, independent: Map<token, [file:target]> }. */
export const collectTokens = async (repoRoot) => {
  const shared = new Map();
  const independent = new Map();
  for (const file of await versionedFiles(repoRoot)) {
    const source = await fs.readFile(path.join(repoRoot, file), "utf8");
    for (const [, target, token] of source.matchAll(TOKEN_PATTERN)) {
      const bucket = isSharedTarget(target) ? shared : independent;
      if (!bucket.has(token)) bucket.set(token, []);
      bucket.get(token).push(`${file} → ${target}`);
    }
  }
  return { shared, independent };
};

export const todayToken = (now = new Date()) =>
  `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

/* 20260905 → 20260905a → 20260905b …; a token from an earlier day → today. */
export const nextToken = (current, now = new Date()) => {
  const today = todayToken(now);
  if (!current || !current.startsWith(today)) return today;
  const suffix = current.slice(today.length);
  if (!suffix) return `${today}a`;
  return `${today}${String.fromCharCode(suffix.charCodeAt(0) + 1)}`;
};

export const rewriteTokens = async (repoRoot, token) => {
  const changed = [];
  for (const file of await versionedFiles(repoRoot)) {
    const absolute = path.join(repoRoot, file);
    const source = await fs.readFile(absolute, "utf8");
    const next = source.replace(TOKEN_PATTERN, (match, target, current) =>
      isSharedTarget(target) && current !== token ? `${target}?v=${token}` : match);
    if (next !== source) {
      await fs.writeFile(absolute, next);
      changed.push(file);
    }
  }
  return changed;
};
