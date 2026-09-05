#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildLocalIndex, COLLECTIONS, SLUG_PATTERN } from "../src/content.js";
import { checkGenerated, writeGenerated } from "../src/generate.js";

const [command, ...argumentsList] = process.argv.slice(2);

const option = (name, fallback) => {
  const index = argumentsList.indexOf(`--${name}`);
  return index >= 0 ? argumentsList[index + 1] : fallback;
};

const repoRoot = path.resolve(process.cwd(), option("repo-root", "../.."));

/* The index, the prerendered pages, the sitemap and the feed are one unit:
   they are all derived from content/ and all committed. */
const rebuild = async ({ check = false } = {}) => {
  if (check) {
    const result = await checkGenerated(repoRoot);
    if (!result.ok) {
      const problems = [
        ...result.stale.map((file) => `${file} is stale or missing`),
        ...result.orphans.map((file) => `${file} no longer has an entry`),
      ];
      throw new Error(`${problems.join("\n")}\nRun content:rebuild (or npm run generate at the repository root).`);
    }
    process.stdout.write("Content index and generated pages are valid and current.\n");
    return;
  }
  const { written, removed } = await writeGenerated(repoRoot);
  process.stdout.write(`Rebuilt ${written.length} generated file(s)${removed.length ? `, removed ${removed.length}` : ""}.\n`);
  for (const file of [...written, ...removed]) process.stdout.write(`  ${file}\n`);
};

const createEntry = async () => {
  const collection = option("collection");
  const slug = option("slug");
  if (!COLLECTIONS.includes(collection)) throw new Error("--collection must be writing, books, or photography.");
  if (!slug || slug.length > 80 || !SLUG_PATTERN.test(slug)) throw new Error("--slug must use lowercase letters, numbers, and single hyphens.");

  const templateName = collection === "books" ? "book.md" : collection === "photography" ? "photography.md" : "writing.md";
  const templatePath = path.join(repoRoot, "content", "_templates", templateName);
  const destination = path.join(repoRoot, "content", collection, `${slug}.md`);
  const template = (await fs.readFile(templatePath, "utf8")).replaceAll("replace-with-slug", slug);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, template, { encoding: "utf8", flag: "wx" });
  if (collection === "photography") {
    await fs.mkdir(path.join(repoRoot, "assets", "photography", slug), { recursive: true });
  }
  process.stdout.write(`Created ${path.relative(repoRoot, destination)}.\n`);
};

try {
  if (command === "new") await createEntry();
  else if (command === "validate") {
    await buildLocalIndex(repoRoot);
    process.stdout.write("Content is valid.\n");
  } else if (command === "rebuild") await rebuild();
  else if (command === "check") await rebuild({ check: true });
  else throw new Error("Use new, validate, rebuild, or check.");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
