import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import YAML from "yaml";
import { badRequest } from "./errors.js";

export const COLLECTIONS = Object.freeze(["writing", "books", "photography"]);
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const IMAGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BOOK_STATUSES = Object.freeze([
  "want-to-read",
  "reading",
  "finished",
  "abandoned",
]);

export const LIMITS = Object.freeze({
  markdownBytes: 256 * 1024,
  title: 120,
  summary: 500,
  tags: 12,
  tag: 32,
  slug: 80,
  images: 12,
  fullImageBytes: 2 * 1024 * 1024,
  thumbnailBytes: 256 * 1024,
  totalImageBytes: 28 * 1024 * 1024,
});

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

const allowedProtocols = new Set(["http:", "https:", "mailto:"]);

const fail = (code, message, details) => {
  throw badRequest(code, message, details);
};

const requireString = (value, field, { max = Number.POSITIVE_INFINITY, optional = false } = {}) => {
  if (optional && (value === undefined || value === null || value === "")) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    fail("invalid_content", `${field} must be a non-empty string.`, { field });
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    fail("invalid_content", `${field} exceeds ${max} characters.`, { field, max });
  }
  return normalized;
};

const requireDate = (value, field, { optional = false } = {}) => {
  if (optional && (value === undefined || value === null || value === "")) return undefined;
  const normalized =
    value instanceof Date && !Number.isNaN(value.valueOf())
      ? value.toISOString().slice(0, 10)
      : String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fail("invalid_content", `${field} must use YYYY-MM-DD.`, { field });
  }
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized) {
    fail("invalid_content", `${field} is not a valid calendar date.`, { field });
  }
  return normalized;
};

const normalizeSlug = (value) => {
  const slug = requireString(value, "slug", { max: LIMITS.slug });
  if (!SLUG_PATTERN.test(slug)) {
    fail("invalid_slug", "slug must contain lowercase letters, numbers, and single hyphens only.", {
      field: "slug",
    });
  }
  return slug;
};

const normalizeTags = (value) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > LIMITS.tags) {
    fail("invalid_content", `tags must be an array of at most ${LIMITS.tags} values.`, {
      field: "tags",
    });
  }
  const tags = value.map((tag, index) =>
    requireString(tag, `tags[${index}]`, { max: LIMITS.tag }),
  );
  if (new Set(tags.map((tag) => tag.toLowerCase())).size !== tags.length) {
    fail("invalid_content", "tags must not contain duplicates.", { field: "tags" });
  }
  return tags;
};

export const assertCollection = (collection) => {
  if (!COLLECTIONS.includes(collection)) {
    fail("invalid_collection", "Unsupported content collection.", { collection });
  }
  return collection;
};

export const entryPath = (collection, slug) => {
  assertCollection(collection);
  return `content/${collection}/${normalizeSlug(slug)}.md`;
};

export const mediaPath = (slug, imageId, thumbnail = false) => {
  const safeSlug = normalizeSlug(slug);
  const safeId = requireString(imageId, "image id", { max: 64 });
  if (!IMAGE_ID_PATTERN.test(safeId)) {
    fail("invalid_image", "image ids must contain lowercase letters, numbers, and single hyphens only.");
  }
  return `assets/photography/${safeSlug}/${safeId}${thumbnail ? "-thumb" : ""}.webp`;
};

export const parseFrontMatter = (source) => {
  if (typeof source !== "string") fail("invalid_content", "Content source must be text.");
  if (Buffer.byteLength(source, "utf8") > LIMITS.markdownBytes) {
    fail("content_too_large", `Markdown must not exceed ${LIMITS.markdownBytes} bytes.`);
  }
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) fail("invalid_front_matter", "Markdown must begin with YAML front matter.");

  let document;
  try {
    document = YAML.parseDocument(match[1], {
      maxAliasCount: 0,
      prettyErrors: false,
      strict: true,
    });
  } catch {
    fail("invalid_front_matter", "YAML front matter is malformed.");
  }
  if (document.errors.length > 0 || document.warnings.length > 0) {
    fail("invalid_front_matter", "YAML front matter is malformed or uses unsupported aliases.");
  }
  YAML.visit(document, {
    Alias() { fail("invalid_front_matter", "YAML aliases are not supported."); },
  });
  const metadata = document.toJS({ maxAliasCount: 0 });
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail("invalid_front_matter", "YAML front matter must be an object.");
  }
  return { metadata, body: match[2].replace(/^\r?\n/, "").replace(/\s+$/, "") };
};

const normalizeImage = (image, index) => {
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    fail("invalid_image", `images[${index}] must be an object.`);
  }
  const unexpected = Object.keys(image).filter((key) => !["id", "file", "thumbnail", "alt", "caption"].includes(key));
  if (unexpected.length) fail("invalid_image", `images[${index}] contains unsupported fields.`, { fields: unexpected });
  const id = requireString(image.id, `images[${index}].id`, { max: 64 });
  if (!IMAGE_ID_PATTERN.test(id)) {
    fail("invalid_image", `images[${index}].id is invalid.`);
  }
  const file = requireString(image.file, `images[${index}].file`, { max: 96 });
  const thumbnail = requireString(image.thumbnail, `images[${index}].thumbnail`, { max: 104 });
  if (file !== `${id}.webp` || thumbnail !== `${id}-thumb.webp`) {
    fail("invalid_image", "Photography filenames must be derived from the image id.", { id });
  }
  return {
    id,
    file,
    thumbnail,
    alt: requireString(image.alt, `images[${index}].alt`, { max: LIMITS.summary }),
    ...(requireString(image.caption, `images[${index}].caption`, {
      max: LIMITS.summary,
      optional: true,
    })
      ? { caption: image.caption.trim() }
      : {}),
  };
};

export const normalizeEntry = (collection, metadata, body = "") => {
  assertCollection(collection);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail("invalid_content", "metadata must be an object.");
  }
  if (typeof body !== "string") fail("invalid_content", "Markdown body must be text.");
  if (Buffer.byteLength(body, "utf8") > LIMITS.markdownBytes) {
    fail("content_too_large", `Markdown must not exceed ${LIMITS.markdownBytes} bytes.`);
  }
  const allowedFields = {
    writing: ["title", "slug", "date", "summary", "tags"],
    books: ["title", "slug", "author", "year", "status", "rating", "started", "finished", "tags"],
    photography: ["title", "slug", "date", "caption", "location", "camera", "images"],
  }[collection];
  const unexpected = Object.keys(metadata).filter((key) => !allowedFields.includes(key));
  if (unexpected.length) fail("invalid_content", "Content contains unsupported metadata fields.", { fields: unexpected });

  const common = {
    title: requireString(metadata.title, "title", { max: LIMITS.title }),
    slug: normalizeSlug(metadata.slug),
  };

  if (collection === "writing") {
    if (body.trim() === "") fail("invalid_content", "Writing requires a Markdown body.");
    return {
      metadata: {
        ...common,
        date: requireDate(metadata.date, "date"),
        summary: requireString(metadata.summary, "summary", { max: LIMITS.summary }),
        tags: normalizeTags(metadata.tags),
      },
      body: body.trim(),
    };
  }

  if (collection === "books") {
    const year = Number(metadata.year);
    if (!Number.isInteger(year) || year < 1 || year > 9999) {
      fail("invalid_content", "year must be a four-digit integer.", { field: "year" });
    }
    const status = requireString(metadata.status, "status");
    if (!BOOK_STATUSES.includes(status)) {
      fail("invalid_content", "status is not a supported reading state.", { field: "status" });
    }
    let rating;
    if (metadata.rating !== undefined && metadata.rating !== null && metadata.rating !== "") {
      rating = Number(metadata.rating);
      if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
        fail("invalid_content", "rating must be between 0 and 5.", { field: "rating" });
      }
    }
    return {
      metadata: {
        ...common,
        author: requireString(metadata.author, "author", { max: LIMITS.title }),
        year,
        status,
        ...(rating === undefined ? {} : { rating }),
        ...(requireDate(metadata.started, "started", { optional: true })
          ? { started: requireDate(metadata.started, "started") }
          : {}),
        ...(requireDate(metadata.finished, "finished", { optional: true })
          ? { finished: requireDate(metadata.finished, "finished") }
          : {}),
        tags: normalizeTags(metadata.tags),
      },
      body: body.trim(),
    };
  }

  const imagesValue = metadata.images;
  if (!Array.isArray(imagesValue) || imagesValue.length === 0 || imagesValue.length > LIMITS.images) {
    fail("invalid_image", `Photography requires 1 to ${LIMITS.images} images.`);
  }
  const images = imagesValue.map(normalizeImage);
  if (new Set(images.map((image) => image.id)).size !== images.length) {
    fail("invalid_image", "Photography image ids must be unique.");
  }
  return {
    metadata: {
      ...common,
      date: requireDate(metadata.date, "date"),
      ...(requireString(metadata.location, "location", { max: LIMITS.title, optional: true })
        ? { location: metadata.location.trim() }
        : {}),
      ...(requireString(metadata.camera, "camera", { max: LIMITS.title, optional: true })
        ? { camera: metadata.camera.trim() }
        : {}),
      caption: requireString(metadata.caption, "caption", { max: LIMITS.summary }),
      images,
    },
    body: "",
  };
};

const safeHref = (href) => {
  try {
    const url = new URL(href, "https://j3w1.github.io/");
    if (!allowedProtocols.has(url.protocol)) fail("unsafe_markdown", "Markdown contains an unsafe link.");
    if (href.startsWith("/") || href.startsWith("#")) return href;
    return url.href;
  } catch {
    fail("unsafe_markdown", "Markdown contains an invalid link.");
  }
};

const inlineAst = (tokens = []) => {
  const root = [];
  const stack = [{ children: root }];
  const current = () => stack.at(-1).children;
  for (const token of tokens) {
    switch (token.type) {
      case "text":
        current().push({ type: "text", value: token.content });
        break;
      case "code_inline":
        current().push({ type: "code", value: token.content });
        break;
      case "softbreak":
        current().push({ type: "text", value: " " });
        break;
      case "hardbreak":
        current().push({ type: "break" });
        break;
      case "em_open":
      case "strong_open": {
        const node = { type: token.type === "em_open" ? "emphasis" : "strong", children: [] };
        current().push(node);
        stack.push(node);
        break;
      }
      case "link_open": {
        const node = { type: "link", href: safeHref(token.attrGet("href") ?? ""), children: [] };
        current().push(node);
        stack.push(node);
        break;
      }
      case "em_close":
      case "strong_close":
      case "link_close":
        if (stack.length === 1) fail("unsafe_markdown", "Markdown nesting is invalid.");
        stack.pop();
        break;
      default:
        fail("unsupported_markdown", `Markdown construct ${token.type} is not supported.`);
    }
  }
  if (stack.length !== 1) fail("unsafe_markdown", "Markdown nesting is invalid.");
  return root;
};

export const markdownToAst = (source) => {
  if (/(?:\]\(|<)\s*(?:javascript|data|vbscript):/i.test(source)) {
    fail("unsafe_markdown", "Markdown contains an unsafe link.");
  }
  const tokens = markdown.parse(source, {});
  const root = [];
  const stack = [{ type: "root", children: root }];
  const current = () => stack.at(-1).children;

  for (const token of tokens) {
    if (token.type === "inline") {
      stack.at(-1).children.push(...inlineAst(token.children));
      continue;
    }
    if (token.type === "fence" || token.type === "code_block") {
      current().push({
        type: "codeBlock",
        language: token.info.trim().split(/\s+/)[0] || "",
        value: token.content.replace(/\n$/, ""),
      });
      continue;
    }
    const openers = {
      paragraph_open: () => ({ type: "paragraph", children: [] }),
      heading_open: () => ({ type: "heading", level: Number(token.tag.slice(1)), children: [] }),
      bullet_list_open: () => ({ type: "list", ordered: false, children: [] }),
      ordered_list_open: () => ({
        type: "list",
        ordered: true,
        start: Number(token.attrGet("start") ?? 1),
        children: [],
      }),
      list_item_open: () => ({ type: "listItem", children: [] }),
      blockquote_open: () => ({ type: "blockquote", children: [] }),
    };
    const closers = new Set([
      "paragraph_close",
      "heading_close",
      "bullet_list_close",
      "ordered_list_close",
      "list_item_close",
      "blockquote_close",
    ]);
    if (openers[token.type]) {
      const node = openers[token.type]();
      current().push(node);
      stack.push(node);
      continue;
    }
    if (closers.has(token.type)) {
      if (stack.length === 1) fail("unsupported_markdown", "Markdown nesting is invalid.");
      stack.pop();
      continue;
    }
    fail("unsupported_markdown", `Markdown construct ${token.type} is not supported.`);
  }
  if (stack.length !== 1) fail("unsupported_markdown", "Markdown nesting is invalid.");
  return root;
};

export const serializeEntry = (collection, metadata, body = "") => {
  const normalized = normalizeEntry(collection, metadata, body);
  const yaml = YAML.stringify(normalized.metadata, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${normalized.body ? `\n${normalized.body}\n` : ""}`;
};

export const compileSource = (collection, source) => {
  const parsed = parseFrontMatter(source);
  const normalized = normalizeEntry(collection, parsed.metadata, parsed.body);
  const result = { ...normalized.metadata };
  if (collection === "writing") result.blocks = markdownToAst(normalized.body);
  if (collection === "books") result.notes = markdownToAst(normalized.body);
  if (collection === "photography") {
    result.images = normalized.metadata.images.map((image) => ({
      ...image,
      src: `/assets/photography/${normalized.metadata.slug}/${image.file}`,
      thumbnailSrc: `/assets/photography/${normalized.metadata.slug}/${image.thumbnail}`,
    }));
  }
  result.contentDigest = createHash("sha256").update(serializeEntry(collection, normalized.metadata, normalized.body)).digest("hex");
  return result;
};

const compareEntries = (left, right) => {
  const leftDate = left.date ?? String(left.year ?? 0);
  const rightDate = right.date ?? String(right.year ?? 0);
  return rightDate.localeCompare(leftDate) || left.slug.localeCompare(right.slug);
};

export const buildIndex = (sourcesByCollection) => {
  const collections = {};
  for (const collection of COLLECTIONS) {
    const sources = sourcesByCollection[collection] ?? [];
    const slugs = new Set();
    collections[collection] = sources
      .map(({ source, path: sourcePath }) => {
        const entry = compileSource(collection, source);
        if (slugs.has(entry.slug)) fail("duplicate_slug", `Duplicate ${collection} slug: ${entry.slug}`);
        slugs.add(entry.slug);
        if (sourcePath && sourcePath !== entryPath(collection, entry.slug)) {
          fail("path_mismatch", `${sourcePath} does not match its slug ${entry.slug}.`);
        }
        return entry;
      })
      .sort(compareEntries);
  }
  return { schemaVersion: 1, collections };
};

export const stringifyIndex = (index) => `${JSON.stringify(index, null, 2)}\n`;

const isWebp = (buffer) =>
  Buffer.isBuffer(buffer) &&
  buffer.length >= 12 &&
  buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
  buffer.subarray(8, 12).toString("ascii") === "WEBP";

export const validateWebp = (buffer, { thumbnail = false } = {}) => {
  if (!isWebp(buffer)) fail("invalid_image", "Image content is not a valid WebP container.");
  const max = thumbnail ? LIMITS.thumbnailBytes : LIMITS.fullImageBytes;
  if (buffer.length > max) fail("image_too_large", `Image exceeds ${max} bytes.`);
  return buffer;
};

export const scanLocalContent = async (repoRoot) => {
  const sources = Object.fromEntries(COLLECTIONS.map((collection) => [collection, []]));
  for (const collection of COLLECTIONS) {
    const directory = path.join(repoRoot, "content", collection);
    await fs.mkdir(directory, { recursive: true });
    const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".md")).sort();
    for (const name of names) {
      const sourcePath = `content/${collection}/${name}`;
      const source = await fs.readFile(path.join(directory, name), "utf8");
      sources[collection].push({ path: sourcePath.replaceAll("\\", "/"), source });
    }
  }
  return sources;
};

export const validateLocalMedia = async (repoRoot, index) => {
  for (const entry of index.collections.photography) {
    let total = 0;
    for (const image of entry.images) {
      for (const [relative, thumbnail] of [
        [image.src, false],
        [image.thumbnailSrc, true],
      ]) {
        const filePath = path.join(repoRoot, relative.replace(/^\//, ""));
        let buffer;
        try {
          buffer = await fs.readFile(filePath);
        } catch {
          fail("missing_image", `Missing photography asset: ${relative}`);
        }
        validateWebp(buffer, { thumbnail });
        total += buffer.length;
      }
    }
    if (total > LIMITS.totalImageBytes) {
      fail("image_too_large", `${entry.slug} exceeds the total photography size limit.`);
    }
  }
};

export const buildLocalIndex = async (repoRoot) => {
  const index = buildIndex(await scanLocalContent(repoRoot));
  await validateLocalMedia(repoRoot, index);
  return index;
};
