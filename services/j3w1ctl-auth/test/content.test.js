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


const photography = (image = {}) => serializeEntry("photography", {
  title: "Moons",
  slug: "moons",
  date: "2026-08-25",
  caption: "Public caption.",
  images: [{ id: "image-01", file: "image-01.webp", thumbnail: "image-01-thumb.webp", alt: "A moon.", ...image }],
}, "");

test("photograph dimensions are optional, validated in pairs, and carried into the index", () => {
  const plain = compileSource("photography", photography());
  assert.equal("width" in plain.images[0], false, "absent dimensions stay absent rather than guessed");

  const sized = compileSource("photography", photography({ width: 1448, height: 1086, thumbnailWidth: 640, thumbnailHeight: 480 }));
  assert.deepEqual(
    [sized.images[0].width, sized.images[0].height, sized.images[0].thumbnailWidth, sized.images[0].thumbnailHeight],
    [1448, 1086, 640, 480],
  );

  assert.throws(() => compileSource("photography", photography({ width: 1448 })), /must both be integers/);
  assert.throws(() => compileSource("photography", photography({ width: "1448", height: 1086 })), /must both be integers/);
  assert.throws(() => compileSource("photography", photography({ thumbnailWidth: 0, thumbnailHeight: 480 })), /must both be integers/);
  assert.throws(() => compileSource("photography", photography({ width: 9000, height: 9000 })), /must both be integers/);
  assert.throws(() => compileSource("photography", photography({ aspect: "4:3" })), /unsupported fields/);
});
