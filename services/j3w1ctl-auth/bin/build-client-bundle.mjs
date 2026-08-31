import { promises as fs } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const serviceRoot = path.resolve(import.meta.dirname, "..");
const target = path.resolve(serviceRoot, "../../admin/j3w1ctl-blob-client.js");
const result = await build({
  entryPoints: [path.join(serviceRoot, "browser/blob-client-entry.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "inline",
  write: false,
});
const generated = result.outputFiles[0].text;

if (process.argv.includes("--check")) {
  const current = await fs.readFile(target, "utf8").catch(() => "");
  if (current !== generated) {
    console.error("The committed Vercel Blob browser bundle is missing or stale. Run npm run client:bundle.");
    process.exitCode = 1;
  } else {
    console.log("The committed Vercel Blob browser bundle is current.");
  }
} else {
  await fs.writeFile(target, generated, "utf8");
  console.log(`Updated ${path.relative(serviceRoot, target)}.`);
}
