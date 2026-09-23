/* content/site.json is the one source for the identity, the projects table,
   the link list and the about buffers; scripts/lib/site.mjs writes them into
   the marked regions of the pages. These tests hold the data honest and the
   templates safe, and keep the copies from creeping back into the scripts. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { applyBlocks, marker, parityProblems, readSite, renderSiteBlocks, validateSite } from "../scripts/lib/site.mjs";
import { richText, siteTitle } from "../scripts/lib/site-templates.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFile(path.join(repoRoot, ...parts), "utf8");
const clone = (value) => structuredClone(value);

test("the committed site data validates and agrees with its mirrors", async () => {
  const site = await readSite(repoRoot);
  assert.equal(site.schemaVersion, 1);
  assert.deepEqual(await parityProblems(repoRoot, site), []);
});

test("validation fails closed", async () => {
  const site = await readSite(repoRoot);
  const reject = (mutate, pattern) => {
    const broken = clone(site);
    mutate(broken);
    assert.throws(() => validateSite(broken), pattern);
  };
  reject((broken) => { broken.extra = 1; }, /root must contain exactly/);
  reject((broken) => { broken.projects.entries[1].id = broken.projects.entries[0].id; }, /projects\.entries repeats/);
  reject((broken) => { broken.projects.entries[0].repository = "http://example.com"; }, /must be an https URL or null/);
  reject((broken) => { broken.projects.entries.find((p) => p.visibility === "internal").repository = "https://example.com"; }, /must be null for an internal project/);
  reject((broken) => { broken.projects.selected = "nobody"; }, /names no project/);
  reject((broken) => { broken.elsewhere.links[0].href = "javascript:alert(1)"; }, /must be https or site-absolute/);
  reject((broken) => { broken.identity.sameAs.push("http://insecure"); }, /must be an https URL/);
  reject((broken) => { broken.site.themeColor = "#FFF"; }, /six-digit hex/);
  reject((broken) => { broken.home.focus[0].name = "Bad Name"; }, /lowercase letters/);
});

test("rendering is deterministic and escapes what the data says", async () => {
  const site = await readSite(repoRoot);
  assert.deepEqual(renderSiteBlocks(site), renderSiteBlocks(site));

  const hostile = clone(site);
  hostile.projects.entries[0].name = 'Evil <script>"x"</script> & co';
  hostile.identity.description = "breaks </script><script>alert(1)</script> out";
  const blocks = renderSiteBlocks(hostile)["index.html"];
  assert.ok(!blocks.projects.includes("<script>"), "a project name must not reach the page as markup");
  assert.ok(blocks.projects.includes("Evil &lt;script&gt;"), "text is escaped");
  assert.ok(blocks.projects.includes('aria-label="Show Evil &lt;script&gt;&quot;x&quot;'), "attributes are escaped");
  assert.equal((blocks.jsonld.match(/<\/script/g) ?? []).length, 1, "JSON-LD cannot close its own element early");
  assert.ok(blocks.jsonld.includes("\\u003c/script>"), "angle brackets inside JSON-LD are escaped");
  assert.ok(blocks.meta.includes("breaks &lt;/script&gt;"), "the meta description is escaped");
});

test("the about paragraphs allow only safe [label](href) links", () => {
  assert.equal(richText("see [the site](https://j3w1.github.io/) & [wiki](/wiki/)"), 'see <a href="https://j3w1.github.io/">the site</a> &amp; <a href="/wiki/">wiki</a>');
  assert.throws(() => richText("[x](javascript:alert(1))"), /unsafe link target/);
  assert.throws(() => richText("[x](http://insecure)"), /unsafe link target/);
});

test("the counts the pages show are derived from the data", async () => {
  const site = await readSite(repoRoot);
  const total = site.projects.entries.length;
  const publicCount = site.projects.entries.filter((project) => project.visibility === "public").length;
  const blocks = renderSiteBlocks(site)["index.html"];
  assert.ok(blocks.projects.includes(`[${total} entries] projects`));
  assert.ok(blocks.projects.includes(`<span data-project-count="public">(${publicCount})</span>`));
  assert.ok(blocks.projects.includes(`<span>${total - publicCount} internal</span>`));
  assert.ok(blocks["home-files"].includes(`<span>${total} entries</span>`));
  assert.ok(blocks.elsewhere.includes(`total ${site.elsewhere.links.length}`));
  assert.equal((blocks.projects.match(/class="project-selector"/g) ?? []).length, total);
  assert.equal((blocks.projects.match(/aria-pressed="true"/g) ?? []).length, 1 + 1, "one selected row, one pressed filter");
});

test("the pages carry the generated blocks and no other copy of the identity", async () => {
  const site = await readSite(repoRoot);
  const html = await read("index.html");
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
  assert.ok(html.includes(`<title>${siteTitle(site)}</title>`));
  for (const name of Object.keys(renderSiteBlocks(site)["index.html"])) {
    assert.equal((html.match(new RegExp(marker(name, "start").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1, `${name} block`);
  }
  for (const file of ["assets/js/wm/apps/shell.js", "assets/js/site.js"]) {
    const source = await read(...file.split("/"));
    assert.doesNotMatch(source, /software engineer/i, `${file} carries a copy of the role`);
    assert.doesNotMatch(source, /machinery behind dependable work/, `${file} carries a copy of the README`);
  }
});

test("applying blocks demands exactly one marker pair per block", () => {
  const page = `a\n${marker("x", "start")}\nold\n${marker("x", "end")}\nb\n`;
  assert.equal(applyBlocks(page, { x: "new" }), `a\n${marker("x", "start")}\nnew\n${marker("x", "end")}\nb\n`);
  assert.throws(() => applyBlocks("nothing", { x: "new" }, "p"), /missing the x markers/);
  assert.throws(() => applyBlocks(page + marker("x", "end"), { x: "new" }, "p"), /more than one x block/);
  assert.throws(() => applyBlocks(`${marker("x", "end")}\n${marker("x", "start")}`, { x: "new" }, "p"), /reversed/);
});
