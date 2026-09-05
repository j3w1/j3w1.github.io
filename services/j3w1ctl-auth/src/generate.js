/* Writes, or checks, every committed artifact derived from content/: the
   content index, the prerendered entry and collection pages, the sitemap and
   the feed. The pure generators live in content.js and site-pages.js; this is
   the only module that touches the working tree. The root `npm run generate`
   and the service's `content:rebuild` / `content:check` both come here, so
   there is one code path for "what should be on disk". */

import { promises as fs } from "node:fs";
import path from "node:path";
import { buildLocalIndex, stringifyIndex } from "./content.js";
import { GENERATED_PAGE_PATTERN, generateSitePages } from "./site-pages.js";

export const INDEX_PATH = "assets/data/content-index.json";

export const collectGenerated = async (repoRoot) => {
  const index = await buildLocalIndex(repoRoot);
  const files = new Map([[INDEX_PATH, stringifyIndex(index)], ...generateSitePages(index)]);
  return { index, files };
};

/* Generated entry directories that no longer correspond to an entry. */
const orphanPages = async (repoRoot, files) => {
  const orphans = [];
  for (const collection of ["writing", "books", "photography"]) {
    const directory = path.join(repoRoot, collection);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relative = entry.isDirectory() ? `${collection}/${entry.name}/index.html` : `${collection}/${entry.name}`;
      if (GENERATED_PAGE_PATTERN.test(relative) && !files.has(relative)) orphans.push(relative);
    }
  }
  return orphans;
};

const normalize = (value) => value.replaceAll("\r\n", "\n");

export const checkGenerated = async (repoRoot) => {
  const { files } = await collectGenerated(repoRoot);
  const stale = [];
  for (const [relative, content] of files) {
    let current = null;
    try {
      current = await fs.readFile(path.join(repoRoot, relative), "utf8");
    } catch {
      /* missing: reported below */
    }
    if (current === null || normalize(current) !== content) stale.push(relative);
  }
  const orphans = await orphanPages(repoRoot, files);
  return { stale, orphans, ok: stale.length === 0 && orphans.length === 0 };
};

export const writeGenerated = async (repoRoot) => {
  const { files } = await collectGenerated(repoRoot);
  const written = [];
  for (const [relative, content] of files) {
    const absolute = path.join(repoRoot, relative);
    let current = null;
    try {
      current = await fs.readFile(absolute, "utf8");
    } catch {
      /* new file */
    }
    if (current !== null && normalize(current) === content) continue;
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf8");
    written.push(relative);
  }
  const removed = [];
  for (const relative of await orphanPages(repoRoot, files)) {
    await fs.rm(path.join(repoRoot, path.dirname(relative)), { recursive: true, force: true });
    removed.push(relative);
  }
  return { written, removed };
};
