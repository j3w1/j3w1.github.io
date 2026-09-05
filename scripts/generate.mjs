#!/usr/bin/env node
/* Regenerates every committed artifact that is derived from something else in
   the repository, or with --check verifies that the committed copies are
   current. GitHub Pages serves `main` verbatim, so generated files are
   committed; CI runs --check so they cannot drift.

   Generators register here as they are added: fonts, the modulepreload list,
   the content index and prerendered pages, the sitemap and feed. */

import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const generators = [];

let failures = 0;
for (const { name, run } of generators) {
  try {
    const result = await run({ repoRoot, check });
    console.log(`${check ? "checked" : "generated"} ${name}${result ? `: ${result}` : ""}`);
  } catch (error) {
    failures += 1;
    console.error(`${name}: ${error.message}`);
  }
}
if (generators.length === 0) console.log(`nothing registered yet (${check ? "check" : "generate"})`);
process.exit(failures ? 1 : 0);
