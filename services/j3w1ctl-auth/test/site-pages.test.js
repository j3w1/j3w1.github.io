import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIndex, serializeEntry } from "../src/content.js";
import { checkGenerated, writeGenerated } from "../src/generate.js";
import { escapeAttribute, escapeText, renderAstHtml } from "../src/html-renderer.js";
import { generateSitePages, renderEntryPage, renderFeed, renderSitemap } from "../src/site-pages.js";

const ORIGIN = "https://j3w1.github.io";
const hostile = "</script><img src=x onerror=alert(1)> & \"quoted\"";

const writing = (overrides = {}, body = "## Heading\n\nA **safe** [link](https://example.com) and a [home link](/wiki/).\n") =>
  ({ path: `content/writing/${overrides.slug ?? "note"}.md`, source: serializeEntry("writing", { title: "A note", slug: "note", date: "2026-08-24", summary: "Summary.", tags: ["systems"], ...overrides }, body) });
const book = (overrides = {}) =>
  ({ path: `content/books/${overrides.slug ?? "book"}.md`, source: serializeEntry("books", { title: "A book", slug: "book", author: "Someone", year: 2020, status: "finished", rating: 4, finished: "2026-01-02", tags: [], ...overrides }, "Notes.\n") });
const photo = (overrides = {}) =>
  ({ path: `content/photography/${overrides.slug ?? "set"}.md`, source: serializeEntry("photography", { title: "A set", slug: "set", date: "2026-08-25", caption: "Caption.", location: "Forest", images: [{ id: "image-01", file: "image-01.webp", thumbnail: "image-01-thumb.webp", alt: "Alt", caption: "One", width: 1448, height: 1086, thumbnailWidth: 640, thumbnailHeight: 480 }], ...overrides }, "") });

const index = () => buildIndex({ writing: [writing(), writing({ slug: "older", date: "2026-01-01" })], books: [book()], photography: [photo()] });
const ldOf = (page) => JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);

test("the HTML renderer escapes everything and rejects what the browser renderer rejects", () => {
  assert.equal(escapeText("a & b < c > d e"), "a &amp; b &lt; c &gt; d&nbsp;e");
  assert.equal(escapeAttribute('x="y" & <z>'), "x=&quot;y&quot; &amp; &lt;z&gt;");
  const html = renderAstHtml([
    { type: "paragraph", children: [{ type: "link", href: "https://example.com/?a=1&b=2", children: [{ type: "text", value: "ext" }] }, { type: "link", href: "/wiki/", children: [{ type: "text", value: "in" }] }] },
    { type: "list", ordered: true, start: 4, children: [{ type: "listItem", children: [{ type: "text", value: "x" }] }] },
    { type: "codeBlock", language: "js", value: "<b>" },
  ], { origin: ORIGIN });
  assert.equal(html, '<p><a href="https://example.com/?a=1&amp;b=2" rel="noopener noreferrer">ext</a><a href="/wiki/">in</a></p><ol start="4"><li>x</li></ol><pre><code data-language="js">&lt;b&gt;</code></pre>');
  assert.throws(() => renderAstHtml([{ type: "link", href: "javascript:alert(1)", children: [] }], { origin: ORIGIN }), /Unsafe link/);
  assert.throws(() => renderAstHtml([{ type: "table" }], { origin: ORIGIN }), /Unsupported content node/);
  assert.throws(() => renderAstHtml([{ type: "heading", level: 7, children: [] }], { origin: ORIGIN }), /Invalid heading/);
});

test("site pages are deterministic, sorted, newline-terminated, and cover every entry", () => {
  const first = generateSitePages(index());
  const second = generateSitePages(index());
  assert.deepEqual([...first.keys()], [...second.keys()]);
  for (const [key, value] of first) {
    assert.equal(value, second.get(key), `${key} must be byte-identical across runs`);
    assert.ok(value.endsWith("\n") && !value.endsWith("\n\n") && !value.includes("\r"), `${key} ends with exactly one newline`);
  }
  assert.deepEqual([...first.keys()], [...first.keys()].sort());
  assert.deepEqual([...first.keys()], ["books/book/index.html", "books/index.html", "feed.xml", "photography/index.html", "photography/set/index.html", "sitemap.xml", "writing/index.html", "writing/note/index.html", "writing/older/index.html"]);
});

test("an entry page carries canonical metadata, the content, and the desktop link", () => {
  const page = renderEntryPage("writing", index().collections.writing[0]);
  assert.match(page, /<link rel="canonical" href="https:\/\/j3w1\.github\.io\/writing\/note\/">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/j3w1\.github\.io\/writing\/note\/">/);
  assert.match(page, /<meta property="og:type" content="article">/);
  assert.match(page, /<meta property="article:published_time" content="2026-08-24">/);
  assert.match(page, /data-desktop-link href="\/#writing\/note"/);
  assert.match(page, /<h2>Heading<\/h2><p>A <strong>safe<\/strong> <a href="https:\/\/example\.com\/" rel="noopener noreferrer">link<\/a> and a <a href="\/wiki\/">home link<\/a>\.<\/p>/);
  assert.equal(ldOf(page)["@type"], "Article");
  assert.equal(ldOf(page).datePublished, "2026-08-24");

  const gallery = renderEntryPage("photography", index().collections.photography[0]);
  assert.match(gallery, /<meta property="og:image" content="https:\/\/j3w1\.github\.io\/assets\/photography\/set\/image-01\.webp">/);
  assert.match(gallery, /<img src="\/assets\/photography\/set\/image-01-thumb\.webp" alt="Alt" width="640" height="480" loading="lazy" decoding="async">/);
  assert.equal(ldOf(gallery)["@type"], "ImageGallery");
  assert.equal(ldOf(gallery).image[0].width, 1448);

  const review = renderEntryPage("books", index().collections.books[0]);
  assert.equal(ldOf(review).about["@type"], "Book");
  assert.equal(ldOf(review).reviewRating.ratingValue, 4);
});

test("hostile titles are inert in HTML, attributes, JSON-LD, the sitemap and the feed", () => {
  const evil = buildIndex({ writing: [writing({ title: hostile, summary: hostile })], books: [], photography: [] });
  const page = renderEntryPage("writing", evil.collections.writing[0]);
  assert.ok(!page.includes("<img src=x"), "the title is escaped in HTML");
  assert.ok(!page.includes('content="</script>'), "the title is escaped in attributes");
  const ldSource = page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
  assert.ok(!ldSource.includes("</script>"), "JSON-LD cannot close its own element");
  assert.equal(JSON.parse(ldSource).headline, hostile, "the JSON-LD still carries the real title");
  const feed = renderFeed(evil);
  assert.ok(!feed.includes("<img src=x"), "the feed escapes titles");
});

test("the sitemap lists real URLs with entry dates, and skips empty collections", () => {
  const sitemap = renderSitemap(index());
  assert.match(sitemap, /<loc>https:\/\/j3w1\.github\.io\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/j3w1\.github\.io\/writing\/<\/loc>\n    <lastmod>2026-08-24<\/lastmod>/);
  assert.match(sitemap, /<loc>https:\/\/j3w1\.github\.io\/writing\/older\/<\/loc>\n    <lastmod>2026-01-01<\/lastmod>/);
  assert.match(sitemap, /<loc>https:\/\/j3w1\.github\.io\/books\/book\/<\/loc>\n    <lastmod>2026-01-02<\/lastmod>/);
  const sparse = renderSitemap(buildIndex({ writing: [], books: [], photography: [photo()] }));
  assert.ok(!sparse.includes("/writing/"), "an empty collection has no sitemap entry");
  const emptyPage = generateSitePages(buildIndex({ writing: [], books: [], photography: [] })).get("writing/index.html");
  assert.match(emptyPage, /<meta name="robots" content="noindex">/);
});

test("the feed is Atom, newest first, with the rendered content", () => {
  const feed = renderFeed(index());
  assert.match(feed, /^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(feed, /<updated>2026-08-25T00:00:00Z<\/updated>/);
  const ids = [...feed.matchAll(/<id>(https[^<]+)<\/id>/g)].map((match) => match[1]);
  assert.deepEqual(ids, [`${ORIGIN}/`, `${ORIGIN}/photography/set/`, `${ORIGIN}/writing/note/`, `${ORIGIN}/books/book/`, `${ORIGIN}/writing/older/`]);
  assert.match(feed, /&lt;h2&gt;Heading&lt;\/h2&gt;/);
});

test("generate writes every derived file, check passes, and tampering or orphans fail it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "j3w1-generate-"));
  try {
    await fs.mkdir(path.join(root, "content", "writing"), { recursive: true });
    await fs.writeFile(path.join(root, "content", "writing", "note.md"), writing().source);
    const { written } = await writeGenerated(root);
    assert.deepEqual(written.sort(), ["assets/data/content-index.json", "books/index.html", "feed.xml", "photography/index.html", "sitemap.xml", "writing/index.html", "writing/note/index.html"]);
    assert.equal((await checkGenerated(root)).ok, true);

    await fs.appendFile(path.join(root, "writing", "note", "index.html"), "<!-- edited -->");
    const tampered = await checkGenerated(root);
    assert.deepEqual(tampered.stale, ["writing/note/index.html"]);

    await fs.mkdir(path.join(root, "writing", "gone"), { recursive: true });
    await fs.writeFile(path.join(root, "writing", "gone", "index.html"), "old");
    const orphaned = await checkGenerated(root);
    assert.deepEqual(orphaned.orphans, ["writing/gone/index.html"]);
    const { removed } = await writeGenerated(root);
    assert.deepEqual(removed, ["writing/gone/index.html"]);
    assert.equal((await checkGenerated(root)).ok, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
