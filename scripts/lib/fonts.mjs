/* The self-hosted font, generated rather than committed whole.

   The workstation's font is Source Code Pro — "Source Code Pro for Powerline"
   in the original Xresources — shipped here as the Nerd Fonts build
   (SauceCodePro Nerd Font Mono), which is the same Adobe glyphs plus the
   Powerline and icon glyphs the desktop draws with. The full patched TTF is
   2.5 MB; the site uses a few hundred glyphs. So the TTF is downloaded into a
   gitignored cache at a pinned release and checksum, cut into small WOFF2
   faces, and the faces are committed. `npm run check` regenerates them in
   memory and fails if the committed copies differ.

   Three faces, so each is fetched only when its glyphs are needed:
     text     — Latin, punctuation, arrows, box drawing and block elements
     icons    — Powerline U+E0A0–E0B3 plus every private-use codepoint found in
                the sources (a new icon cannot silently fall back to a box)
     wordmark — the bold "j3w1-i3" on the wallpaper, six characters

   Every face is served with ?v=<content hash>, written into site.css and the
   preload links by this generator; the shared dated token never touches fonts. */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import subsetFont from "subset-font";

const RELEASE = "v3.5.1";
const SOURCES = {
  regular: {
    url: `https://raw.githubusercontent.com/ryanoasis/nerd-fonts/${RELEASE}/patched-fonts/SourceCodePro/SauceCodeProNerdFontMono-Regular.ttf`,
    sha256: "cbfe6a91123b9d78a1b593cb2efa10a806a704490e3cea6b894078b86d67c0b1",
  },
  bold: {
    url: `https://raw.githubusercontent.com/ryanoasis/nerd-fonts/${RELEASE}/patched-fonts/SourceCodePro/SauceCodeProNerdFontMono-Bold.ttf`,
    sha256: "fedd1dcdfc4228621075dc8a61190474aace7617aff61d1faca877d340a40ff6",
  },
};

export const FAMILY = "SauceCodePro NFM";
export const FONT_DIR = "assets/fonts";
const CSS_START = "/* @generated-fonts:start */";
const CSS_END = "/* @generated-fonts:end */";

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const TEXT_CODEPOINTS = [
  ...range(0x0020, 0x007e),
  ...range(0x00a0, 0x00ff),
  ...range(0x0100, 0x017f),
  ...range(0x2000, 0x206f),
  ...range(0x2190, 0x21ff),
  0x2212,
  ...range(0x2500, 0x257f),
  ...range(0x2580, 0x259f),
  ...range(0x25a0, 0x25ff),
];
const POWERLINE_CODEPOINTS = range(0xe0a0, 0xe0b3);
const WORDMARK_TEXT = "j3w1-i3";

/* Metric-matched local fallbacks: the advance of Source Code Pro is 600/1000,
   so scaling each fallback by 0.6 / its own advance makes every `ch` unit —
   and therefore every ch-measured layout — identical before and after the
   swap. Advances are the fonts' published values. */
const FALLBACKS = [
  { name: "Cascadia Mono", advance: 1200 / 2048 },
  { name: "Consolas", advance: 1126 / 2048 },
  { name: "Liberation Mono", advance: 1229 / 2048 },
  { name: "DejaVu Sans Mono", advance: 1233 / 2048 },
];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/* Scans the shipped sources for private-use codepoints — the Nerd glyphs the
   bar, the file manager and the wiki draw with — in every form they appear:
   HTML entities, JavaScript escapes, and raw characters. */
export const collectIconCodepoints = async (repoRoot) => {
  const files = [
    "index.html", "wiki/index.html", "404.html", "admin/index.html",
    "assets/css/site.css", "assets/css/desktop.css",
  ];
  const walk = async (dir) => {
    const found = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...await walk(next));
      else if (/\.(js|mjs|css|html|txt|conf|md)$/.test(entry.name)) found.push(next);
    }
    return found;
  };
  const scanned = new Set();
  for (const relative of files) {
    try {
      await fs.access(path.join(repoRoot, relative));
      scanned.add(path.join(repoRoot, relative));
    } catch { /* optional page */ }
  }
  for (const dir of ["assets/js", "assets/data", "admin"]) {
    try {
      for (const file of await walk(path.join(repoRoot, dir))) {
        if (!file.includes("blob-client")) scanned.add(file);
      }
    } catch { /* optional directory */ }
  }
  const codepoints = new Set(POWERLINE_CODEPOINTS);
  const pua = (value) => (value >= 0xe000 && value <= 0xf8ff) || (value >= 0xf0000 && value <= 0xffffd);
  for (const file of scanned) {
    const source = await fs.readFile(file, "utf8");
    for (const [, hex] of source.matchAll(/&#x([0-9a-fA-F]{4,5});/g)) {
      const value = Number.parseInt(hex, 16);
      if (pua(value)) codepoints.add(value);
    }
    for (const [, hex] of source.matchAll(/\\u\{?([0-9a-fA-F]{4,5})\}?/g)) {
      const value = Number.parseInt(hex, 16);
      if (pua(value)) codepoints.add(value);
    }
    for (const char of source) {
      const value = char.codePointAt(0);
      if (pua(value)) codepoints.add(value);
    }
  }
  return [...codepoints].sort((a, b) => a - b);
};

const ensureSource = async (repoRoot, key) => {
  const { url, sha256: expected } = SOURCES[key];
  const cacheDir = path.join(repoRoot, ".cache", "fonts");
  const target = path.join(cacheDir, path.basename(url));
  try {
    const cached = await fs.readFile(target);
    if (sha256(cached) === expected) return cached;
  } catch { /* not cached yet */ }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not download ${url}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const actual = sha256(buffer);
  if (actual !== expected) throw new Error(`${path.basename(url)} checksum ${actual} does not match the pinned ${expected}`);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(target, buffer);
  return buffer;
};

/* Reads the vertical metrics and the monospace advance straight from the
   sfnt tables: unitsPerEm from head, ascender/descender/lineGap from hhea, and
   the modal advance from hmtx (every glyph in a mono font shares it). */
export const readMetrics = (buffer) => {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tables = new Map();
  const count = view.getUint16(4);
  for (let i = 0; i < count; i += 1) {
    const offset = 12 + i * 16;
    const tag = String.fromCharCode(...buffer.subarray(offset, offset + 4));
    tables.set(tag, { offset: view.getUint32(offset + 8), length: view.getUint32(offset + 12) });
  }
  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  if (!head || !hhea || !hmtx) throw new Error("font is missing head/hhea/hmtx");
  const unitsPerEm = view.getUint16(head.offset + 18);
  const ascender = view.getInt16(hhea.offset + 4);
  const descender = view.getInt16(hhea.offset + 6);
  const lineGap = view.getInt16(hhea.offset + 8);
  const metricCount = view.getUint16(hhea.offset + 34);
  const advances = new Map();
  for (let i = 0; i < metricCount; i += 1) {
    const advance = view.getUint16(hmtx.offset + i * 4);
    advances.set(advance, (advances.get(advance) ?? 0) + 1);
  }
  const advance = [...advances.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { unitsPerEm, ascender, descender, lineGap, advance };
};

const subset = (source, codepoints, options = {}) =>
  subsetFont(source, String.fromCodePoint(...codepoints), { targetFormat: "woff2", ...options });

const percent = (value) => `${(value * 100).toFixed(3).replace(/\.?0+$/, "")}%`;

const fontFaceCss = ({ family, file, token, weight, unicodeRange }) => [
  "@font-face {",
  `  font-family: "${family}";`,
  `  src: url("../fonts/${file}?v=${token}") format("woff2");`,
  "  font-style: normal;",
  `  font-weight: ${weight};`,
  "  font-display: swap;",
  ...(unicodeRange ? [`  unicode-range: ${unicodeRange};`] : []),
  "}",
].join("\n");

const fallbackCss = (metrics) => {
  const em = metrics.unitsPerEm;
  return FALLBACKS.map(({ name, advance }) => {
    /* size-adjust scales every metric, the overrides included, so the
       overrides are pre-divided to land on Source Code Pro's own values. */
    const size = (metrics.advance / em) / advance;
    return [
      "@font-face {",
      `  font-family: "${FAMILY} fallback ${name}";`,
      `  src: local("${name}");`,
      `  size-adjust: ${percent(size)};`,
      `  ascent-override: ${percent(metrics.ascender / em / size)};`,
      `  descent-override: ${percent(-metrics.descender / em / size)};`,
      `  line-gap-override: ${percent(metrics.lineGap / em / size)};`,
      "}",
    ].join("\n");
  }).join("\n\n");
};

export const fallbackStack = () =>
  [`"${FAMILY}"`, ...FALLBACKS.map(({ name }) => `"${FAMILY} fallback ${name}"`), "monospace"].join(", ");

/* Builds every face in memory. Returns { files: Map<relativePath, Buffer>,
   css: string, tokens: { text, icons, wordmark }, report }. */
export const buildFonts = async (repoRoot) => {
  const regular = await ensureSource(repoRoot, "regular");
  const bold = await ensureSource(repoRoot, "bold");
  const icons = await collectIconCodepoints(repoRoot);

  const faces = [
    { name: "text", source: regular, codepoints: TEXT_CODEPOINTS, weight: 400 },
    { name: "icons", source: regular, codepoints: icons, weight: 400, unicodeRange: "U+E000-F8FF, U+F0000-FFFFD" },
    { name: "wordmark", source: bold, codepoints: [...new Set([...WORDMARK_TEXT].map((c) => c.codePointAt(0)))], weight: 700 },
  ];

  const files = new Map();
  const tokens = {};
  const report = [];
  const cssFaces = [];
  for (const face of faces) {
    const woff2 = await subset(face.source, face.codepoints);
    const file = `sauce-code-pro-${face.name}.woff2`;
    const token = sha256(woff2).slice(0, 8);
    files.set(`${FONT_DIR}/${file}`, woff2);
    tokens[face.name] = token;
    report.push(`${file} ${woff2.length} bytes, ${face.codepoints.length} codepoints`);
    cssFaces.push(fontFaceCss({ family: FAMILY, file, token, weight: face.weight, unicodeRange: face.unicodeRange }));
  }

  const metrics = readMetrics(regular);
  const css = [
    CSS_START,
    `/* Generated by scripts/generate.mjs from SauceCodePro Nerd Font Mono ${RELEASE}. Do not edit. */`,
    ...cssFaces,
    "",
    fallbackCss(metrics),
    CSS_END,
  ].join("\n\n").replace(/\n\n\n+/g, "\n\n");

  const manifest = JSON.stringify({
    source: `SauceCodePro Nerd Font Mono ${RELEASE}`,
    faces: Object.fromEntries([...files].map(([file, buffer]) => [path.basename(file), { bytes: buffer.length, sha256: sha256(buffer) }])),
    icons: icons.map((value) => `U+${value.toString(16).toUpperCase().padStart(4, "0")}`),
  }, null, 2) + "\n";
  files.set(`${FONT_DIR}/manifest.json`, Buffer.from(manifest));

  return { files, css, tokens, report: report.join("; ") };
};

/* The places the generated output lands: the marked block in site.css, the
   preload links in the three pages that carry one, and the font files. */
const PRELOAD_PAGES = ["index.html", "wiki/index.html", "admin/index.html"];

export const applyFonts = async (repoRoot, { files, css, tokens }, { check = false } = {}) => {
  const stale = [];
  const write = async (relative, next) => {
    const absolute = path.join(repoRoot, relative);
    let current = null;
    try { current = await fs.readFile(absolute); } catch { /* missing */ }
    const same = current && (Buffer.isBuffer(next) ? current.equals(next) : current.toString("utf8").replaceAll("\r\n", "\n") === next);
    if (same) return;
    stale.push(relative);
    if (!check) {
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, next);
    }
  };

  for (const [relative, buffer] of files) await write(relative, buffer);

  const siteCss = (await fs.readFile(path.join(repoRoot, "assets/css/site.css"), "utf8")).replaceAll("\r\n", "\n");
  const start = siteCss.indexOf(CSS_START);
  const end = siteCss.indexOf(CSS_END);
  if (start < 0 || end < 0) throw new Error(`site.css must contain the ${CSS_START} … ${CSS_END} markers`);
  const nextCss = siteCss.slice(0, start) + css + siteCss.slice(end + CSS_END.length);
  await write("assets/css/site.css", nextCss);

  const preload = `/assets/fonts/sauce-code-pro-text.woff2?v=${tokens.text}`;
  for (const page of PRELOAD_PAGES) {
    let html;
    try { html = (await fs.readFile(path.join(repoRoot, page), "utf8")).replaceAll("\r\n", "\n"); } catch { continue; }
    const next = html.replace(/\/assets\/fonts\/sauce-code-pro-text\.woff2\?v=[0-9a-f]+/g, preload);
    await write(page, next);
  }

  /* Anything else under assets/fonts that this generator did not produce —
     the old 2.4 MB TTF above all — must not linger. */
  const keep = new Set([...files.keys()].map((file) => path.basename(file)));
  keep.add("OFL.txt");
  for (const entry of await fs.readdir(path.join(repoRoot, FONT_DIR))) {
    if (keep.has(entry)) continue;
    stale.push(`${FONT_DIR}/${entry} (unexpected)`);
    if (!check) await fs.rm(path.join(repoRoot, FONT_DIR, entry));
  }
  return stale;
};

export const fontsGenerator = {
  name: "fonts",
  async run({ repoRoot, check }) {
    const built = await buildFonts(repoRoot);
    const stale = await applyFonts(repoRoot, built, { check });
    if (check && stale.length) throw new Error(`stale: ${stale.join(", ")} — run npm run generate`);
    return `${built.report}${stale.length ? ` (${stale.length} file(s) written)` : ""}`;
  },
};
