#!/usr/bin/env node
/* Usage: node scripts/bump-cache-token.mjs [token | --check]
   With no argument the shared token becomes today's date (or the next letter
   suffix if it is already today's). --check prints every token in use and
   exits 1 if the shared group is not exactly one token. */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectTokens, nextToken, rewriteTokens } from "./lib/cache-tokens.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argument = process.argv[2];

const report = ({ shared, independent }) => {
  console.log("shared token(s):");
  for (const [token, uses] of shared) console.log(`  ${token}  (${uses.length} references)`);
  console.log("independent tokens:");
  for (const [token, uses] of independent) console.log(`  ${token}  ${uses.join(", ")}`);
};

const before = await collectTokens(repoRoot);
if (argument === "--check") {
  report(before);
  if (before.shared.size !== 1) {
    console.error(`\nThe shared group uses ${before.shared.size} tokens; it must use exactly one.`);
    process.exit(1);
  }
  process.exit(0);
}

const current = [...before.shared.keys()].sort().at(-1);
const token = argument && /^\d{8}[a-z]?$/.test(argument) ? argument : nextToken(current);
const changed = await rewriteTokens(repoRoot, token);
console.log(`${current ?? "(none)"} → ${token}: ${changed.length} file(s) updated`);
for (const file of changed) console.log(`  ${file}`);
