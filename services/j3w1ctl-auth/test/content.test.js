import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIndex,
  compileSource,
  markdownToAst,
  serializeEntry,
  stringifyIndex,
  validateWebp,
} from "../src/content.js";

const writing = (overrides = {}) => serializeEntry("writing", {
  title: "A durable note",
  slug: "durable-note",
  date: "2026-08-24",
  summary: "A public summary.",
  tags: ["systems"],
  ...overrides,
}, "## Heading\n\nA **safe** [link](https://example.com).\n");

test("content compilation is deterministic and returns restricted AST", () => {
  const source = writing();
  const first = stringifyIndex(buildIndex({ writing: [{ path: "content/writing/durable-note.md", source }] }));
  const second = stringifyIndex(buildIndex({ writing: [{ path: "content/writing/durable-note.md", source }] }));
  assert.equal(first, second);
  const entry = JSON.parse(first).collections.writing[0];
  assert.equal(entry.slug, "durable-note");
  assert.deepEqual(entry.blocks.map(({ type }) => type), ["heading", "paragraph"]);
  assert.equal("generatedHtml" in entry, false);
});

test("unsafe protocols, unsupported metadata, aliases, and malformed slugs fail", () => {
  assert.throws(() => markdownToAst("[bad](javascript:alert(1))"), /unsafe link/i);
  assert.throws(() => writing({ slug: "../escape" }), /slug/i);
  assert.throws(() => compileSource("writing", writing({ extra: "no" })), /unsupported metadata/i);
  const alias = "---\ntitle: &name Hello\nslug: hello\ndate: 2026-08-24\nsummary: *name\n---\n\nBody\n";
  assert.throws(() => compileSource("writing", alias), /aliases/i);
});

test("raw HTML is emitted only as text nodes", () => {
  const ast = markdownToAst("<img src=x onerror=alert(1)>");
  assert.equal(JSON.stringify(ast).includes('"type":"text"'), true);
  assert.equal(JSON.stringify(ast).includes('"type":"html"'), false);
});

test("WebP signature and per-file size policy are checked from bytes", () => {
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.from("data")]);
  assert.equal(validateWebp(webp), webp);
  assert.throws(() => validateWebp(Buffer.from("not-webp")), /valid WebP/i);
});

