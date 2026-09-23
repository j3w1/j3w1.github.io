import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildThemeCss,
  INTEGRATION_ID,
  INTEGRATION_VERSION,
  LEGACY_THEME_MAP,
  parseDefaultColorProperties,
  parseDefaultProperties,
  THEME_END,
  THEME_EXPORT,
  THEME_LOCK_FILE,
  THEME_PASSTHROUGH,
  THEME_START,
  THEME_VENDOR_FILE,
  themeDigest,
  themeGenerator,
  validateThemeLock,
} from "../scripts/lib/theme.mjs";
import { parseThemeRef, resolveThemeRevision } from "../scripts/update-theme.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFile(path.join(repoRoot, ...parts));

/* The pin. Bumping the theme means changing these four values together with
   theme.lock.json and the vendored export, then reviewing the diff below. */
const EXPECTED_VERSION = "1.1.0";
const EXPECTED_REF = "v1.1.0";
const EXPECTED_REVISION = "7d1389ed11dbca002e9d77f378d8c3a516770620";
const EXPECTED_DIGEST = "sha256-Xtd/k0yv0Dvx4oznpb29MfqOqufhWgNT9NTk1QELhDU=";

/* The legacy aliases as v0.1.0 resolved them. v1.1.0 (D-023, True Black /
   Rose) changes exactly three surfaces; everything else the site names is
   unchanged, and the test below proves it. */
const V0_1_0_VALUES = {
  "--desktop": "#000000",
  "--terminal": "#0c0909",
  "--chrome": "#100909",
  "--chrome-alt": "#1c0a09",
  "--surface": "#160b0b",
  "--surface-raised": "#241010",
  "--selection": "#911410",
  "--selection-dark": "#630f0d",
  "--selection-soft": "#420f0c",
  "--button": "#871f19",
  "--focus": "#e53935",
  "--focus-dim": "#dc282e",
  "--foreground": "#e99499",
  "--foreground-bright": "#ffa2a7",
  "--prose": "#f4eeee",
  "--muted": "#bd787d",
  "--quiet": "#ad7175",
  "--inactive": "#7d1310",
  "--border": "#531310",
  "--border-strong": "#9e231f",
  "--border-active": "#e53935",
  "--color0": "#0c0909",
  "--color1": "#c81a1a",
  "--color2": "#bd787d",
  "--color3": "#d4868b",
  "--color4": "#8c1212",
  "--color5": "#f73f35",
  "--color6": "#9e474a",
  "--color7": "#ffa2a7",
  "--color8": "#7d1310",
  "--color9": "#ab1612",
  "--color10": "#ad2721",
  "--color11": "#b37175",
  "--color12": "#871f19",
  "--color13": "#e82132",
  "--color14": "#e0292f",
  "--color15": "#a3676b",
};

const declarations = (css) => new Map(
  [...css.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);\s*$/gm)]
    .map((match) => [match[1], match[2]]),
);

test("theme.lock.json pins the approved v1.1.0 CSS-variable integration", async () => {
  const lock = JSON.parse(await read(THEME_LOCK_FILE));
  assert.doesNotThrow(() => validateThemeLock(lock));
  assert.equal(lock.version, EXPECTED_VERSION);
  assert.equal(lock.ref, EXPECTED_REF);
  assert.equal(lock.revision, EXPECTED_REVISION);
  assert.equal(lock.profile, "default");
  assert.deepEqual(lock.integration, {
    id: INTEGRATION_ID,
    version: INTEGRATION_VERSION,
    kind: "css-vars",
  });
  assert.equal(lock.exports[THEME_EXPORT], EXPECTED_DIGEST);
  assert.deepEqual(lock.components, []);
  assert.deepEqual(lock.deviations, []);
});

test("the vendored export has the published digest", async () => {
  const vendor = await read(...THEME_VENDOR_FILE.split("/"));
  assert.equal(vendor.includes(Buffer.from("\r\n")), false, "vendored theme must use LF");
  assert.equal(themeDigest(vendor), EXPECTED_DIGEST);
});

test("the default profile changes exactly the three True Black / Rose surfaces", async () => {
  const lock = JSON.parse(await read(THEME_LOCK_FILE));
  const vendor = await read(...THEME_VENDOR_FILE.split("/"));
  const parsed = parseDefaultProperties(vendor);
  /* The heritage profile keeps the old canvas; the parser must never read a
     profile block as if it were the default. */
  assert.equal(parsed.get("--color-surface-canvas"), "#000000");
  assert.ok(
    vendor.toString("utf8").includes("[data-profile=\"heritage-ansi\"]") &&
      vendor.toString("utf8").includes("--color-surface-canvas: #0c0909"),
    "fixture must exercise a profile override of surface.canvas",
  );

  const generated = buildThemeCss(vendor, lock);
  const mapped = declarations(generated);
  assert.equal(LEGACY_THEME_MAP.length, 37);
  assert.equal(mapped.size, LEGACY_THEME_MAP.length + THEME_PASSTHROUGH.length);
  assert.ok(Buffer.byteLength(generated, "utf8") < 3072, "generated block must stay below 3 KiB");
  assert.equal(mapped.has("--xbg"), false);
  assert.equal(mapped.has("--xfg"), false);

  const changes = Object.entries(V0_1_0_VALUES)
    .filter(([name, before]) => mapped.get(name) !== before)
    .map(([name, before]) => ({ name, before, after: mapped.get(name) }));
  assert.deepEqual(changes, [
    { name: "--terminal", before: "#0c0909", after: "#000000" },
    { name: "--chrome", before: "#100909", after: "#090707" },
    { name: "--surface", before: "#160b0b", after: "#100c0c" },
  ]);
});

test("the pass-through copies roles and scales under their canonical names", async () => {
  const lock = JSON.parse(await read(THEME_LOCK_FILE));
  const vendor = await read(...THEME_VENDOR_FILE.split("/"));
  const mapped = declarations(buildThemeCss(vendor, lock));
  for (const token of THEME_PASSTHROUGH) {
    assert.doesNotMatch(token, /^--color-primitive-/, token + " is a primitive");
    assert.ok(mapped.has(token), token + " missing from the generated block");
  }
  /* D-024: links are the strong red with a persistent underline. */
  assert.equal(mapped.get("--color-text-link"), "#f73f35");
  assert.equal(mapped.get("--color-text-link-underline"), "#dc282e");
  assert.equal(mapped.get("--color-text-link-hover"), "#f4eeee");
  assert.equal(mapped.get("--color-surface-backdrop"), "rgb(0 0 0 / 65%)");
  assert.equal(mapped.get("--focus-ring"), "1px dashed #e53935");
  assert.equal(mapped.get("--focus-ring-container"), "2px solid #ffa2a7");
  assert.equal(mapped.get("--z-skip-link"), "1000");
  /* The i3 metrics the site keeps as literals agree with the theme's scale. */
  assert.equal(mapped.get("--font-size-terminal"), "13px");
  assert.equal(mapped.get("--font-size-ui-lg"), "14px");
  assert.equal(mapped.get("--font-size-ui-md"), "13px");
});

test("site.css commits the current generated block and keeps host variables authored", async () => {
  const lock = JSON.parse(await read(THEME_LOCK_FILE));
  const vendor = await read(...THEME_VENDOR_FILE.split("/"));
  const expected = buildThemeCss(vendor, lock);
  const siteCss = (await read("assets", "css", "site.css")).toString("utf8");
  const start = siteCss.indexOf(THEME_START);
  const end = siteCss.indexOf(THEME_END);
  assert.ok(start >= 0 && end > start);
  assert.equal(siteCss.slice(start, end + THEME_END.length), expected);

  const authored = siteCss.slice(end + THEME_END.length);
  for (const line of [
    "--bar-height: 28px;",
    "--font-size-term: 13px;",
    "--font-size-i3: 14px;",
    "--font-size-bar: 13px;",
    "--gaps-outer: -2px;",
    "--font:",
  ]) {
    assert.ok(authored.includes(line), "hand-authored root is missing " + line);
  }
  /* Nothing the generator owns may be re-declared by hand. */
  for (const [legacy] of LEGACY_THEME_MAP) {
    assert.doesNotMatch(authored, new RegExp("^\\s*" + legacy + ":", "m"), legacy + " is authored twice");
  }
  assert.doesNotMatch(authored, /^\s*--color-/m, "theme tokens must come from the generated block");
});

/* Every colour the site paints resolves through the generated block. A literal
   that slipped back in would silently keep an old surface after the next pin
   moves the theme — exactly what the True Black / Rose upgrade found. The two
   ::backdrop literals are Safari fallbacks and equal the token's own value. */
test("no colour literal survives outside the generated theme block", async () => {
  const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const allowed = new Set(["rgb(0 0 0 / 65%)"]);
  const siteCss = (await read("assets", "css", "site.css")).toString("utf8");
  const authored = siteCss.slice(siteCss.indexOf(THEME_END) + THEME_END.length);
  const sheets = [
    ["assets/css/site.css", authored],
    ["assets/css/desktop.css", (await read("assets", "css", "desktop.css")).toString("utf8")],
    ["admin/j3w1ctl.css", (await read("admin", "j3w1ctl.css")).toString("utf8")],
  ];
  for (const [name, css] of sheets) {
    const literals = [...stripComments(css).matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)]
      .map((match) => match[0])
      .filter((literal) => !allowed.has(literal));
    assert.deepEqual(literals, [], name + " paints colours the theme did not resolve");
  }
});

test("theme parsing and validation fail closed", async () => {
  assert.throws(
    () => parseDefaultProperties(":root {\n  --color-a: #000000;\n  --color-a: #111111;\n}\n"),
    /repeats --color-a/,
  );
  assert.throws(
    () => parseDefaultProperties("[data-profile=\"default\"] {\n  --color-a: #000000;\n}\n"),
    /exactly one default :root/,
  );
  const colours = parseDefaultColorProperties(":root {\n  --color-a: #000000;\n  --space-1: 1px;\n}\n");
  assert.deepEqual([...colours.keys()], ["--color-a"]);

  const lock = JSON.parse(await read(THEME_LOCK_FILE));
  const vendor = await read(...THEME_VENDOR_FILE.split("/"));
  assert.throws(
    () => buildThemeCss(vendor, {
      ...lock,
      exports: { [THEME_EXPORT]: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    }),
    /does not match the pinned/,
  );
  assert.throws(
    () => validateThemeLock({ ...lock, integration: { ...lock.integration, version: "1" } }),
    /integration version must be/,
  );
  assert.throws(() => parseThemeRef("main"), /release tag.*full lowercase commit/);
  assert.equal(parseThemeRef(EXPECTED_REF), EXPECTED_REF);
  assert.equal(parseThemeRef(EXPECTED_REVISION), EXPECTED_REVISION);
});

test("the updater dereferences annotated tags to commits", async () => {
  const tagObject = "c11749bf0000000000000000000000000000abcd";
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const body = url.includes("/git/ref/tags/")
      ? { object: { type: "tag", sha: tagObject } }
      : { object: { type: "commit", sha: EXPECTED_REVISION } };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  assert.equal(
    await resolveThemeRevision(EXPECTED_REF, { fetchImpl }),
    EXPECTED_REVISION,
  );
  assert.equal(requested.length, 2);
  assert.match(requested[0], /\/git\/ref\/tags\/v1\.1\.0$/);
  assert.match(requested[1], new RegExp("/git/tags/" + tagObject + "$"));
});

test("theme check detects stale output and generation converges", async (context) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "j3w1-theme-"));
  context.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(tempRoot, path.dirname(THEME_VENDOR_FILE)), { recursive: true });
  await fs.mkdir(path.join(tempRoot, "assets", "css"), { recursive: true });
  await fs.copyFile(path.join(repoRoot, THEME_LOCK_FILE), path.join(tempRoot, THEME_LOCK_FILE));
  await fs.copyFile(
    path.join(repoRoot, THEME_VENDOR_FILE),
    path.join(tempRoot, THEME_VENDOR_FILE),
  );
  await fs.writeFile(
    path.join(tempRoot, "assets", "css", "site.css"),
    THEME_START + "\n:root {}\n" + THEME_END + "\n\n:root { --gap: 3px; }\n",
  );

  await assert.rejects(
    themeGenerator.run({ repoRoot: tempRoot, check: true }),
    /stale: assets\/css\/site\.css/,
  );
  await themeGenerator.run({ repoRoot: tempRoot, check: false });
  const once = await fs.readFile(path.join(tempRoot, "assets", "css", "site.css"));
  await themeGenerator.run({ repoRoot: tempRoot, check: false });
  const twice = await fs.readFile(path.join(tempRoot, "assets", "css", "site.css"));
  assert.ok(once.equals(twice), "a second generation must be byte-identical");
  await assert.doesNotReject(themeGenerator.run({ repoRoot: tempRoot, check: true }));

  await fs.appendFile(path.join(tempRoot, THEME_VENDOR_FILE), "/* tampered */\n");
  await assert.rejects(
    themeGenerator.run({ repoRoot: tempRoot, check: true }),
    /does not match the pinned/,
  );
});
