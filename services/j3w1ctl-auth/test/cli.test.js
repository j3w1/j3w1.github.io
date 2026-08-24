import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const serviceRoot = path.resolve(import.meta.dirname, "..");

test("content:new copies the selected template and refuses overwrite", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "j3w1ctl-cli-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "content", "_templates"), { recursive: true });
  await fs.copyFile(path.join(serviceRoot, "..", "..", "content", "_templates", "writing.md"), path.join(root, "content", "_templates", "writing.md"));
  const args = [path.join(serviceRoot, "bin", "content-cli.mjs"), "new", "--repo-root", root, "--collection", "writing", "--slug", "new-entry"];
  await exec(process.execPath, args, { cwd: serviceRoot });
  assert.match(await fs.readFile(path.join(root, "content", "writing", "new-entry.md"), "utf8"), /slug: new-entry/);
  await assert.rejects(() => exec(process.execPath, args, { cwd: serviceRoot }), /EEXIST|exist/i);
});

