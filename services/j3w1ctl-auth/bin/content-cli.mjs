#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildLocalIndex, COLLECTIONS, SLUG_PATTERN, stringifyIndex } from "../src/content.js";

const [command, ...argumentsList] = process.argv.slice(2);

const option = (name, fallback) => {
  const index = argumentsList.indexOf(`--${name}`);
  return index >= 0 ? argumentsList[index + 1] : fallback;
};

const repoRoot = path.resolve(process.cwd(), option("repo-root", "../.."));
const indexPath = path.join(repoRoot, "assets", "data", "content-index.json");

const rebuild = async ({ check = false } = {}) => {
  const content = stringifyIndex(await buildLocalIndex(repoRoot));
  if (check) {
    let current = "";
    try {
      current = await fs.readFile(indexPath, "utf8");
    } catch {
      // The comparison below provides the actionable error.
    }
    if (current.replaceAll("\r\n", "\n") !== content) {
      throw new Error("assets/data/content-index.json is stale; run content:rebuild.");
    }
    process.stdout.write("Content index is valid and current.\n");
    return;
  }
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, content, "utf8");
  process.stdout.write(`Rebuilt ${path.relative(repoRoot, indexPath)}.\n`);
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
