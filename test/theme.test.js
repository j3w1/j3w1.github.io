import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildThemeCss,
  LEGACY_THEME_MAP,
  parseDefaultColorProperties,
  THEME_END,
  THEME_EXPORT,
  THEME_LOCK_FILE,
  THEME_START,
  THEME_VENDOR_FILE,
  themeDigest,
  themeGenerator,
  validateThemeLock,
} from "../scripts/lib/theme.mjs";
import { parseThemeRef, resolveThemeRevision } from "../scripts/update-theme.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFile(path.join(repoRoot, ...parts));
const EXPECTED_REVISION = "328076217d2728ee7dc2aea01c2f71452dbfc9c5";
const EXPECTED_DIGEST = "sha256-xvJ8yxOUx3UEgxXt7wGNyNBvy+DzDIHuzJruIeOSS2E=";

const PRE_ADOPTION_VALUES = {
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
  "--quiet": "#a3676b",
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
  [...css.matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9a-f]{6});\s*$/gm)]
    .map((match) => [match[1], match[2]]),
);

test("theme.lock.json pins the approved v0.1.0 CSS-variable integration", async () => {
  const lock = JSON.parse(await read(THEME_LOCK_FILE));
  assert.doesNotThrow(() => validateThemeLock(lock));
  assert.equal(lock.version, "0.1.0");
  assert.equal(lock.ref, "v0.1.0");
  assert.equal(lock.revision, EXPECTED_REVISION);
  assert.equal(lock.profile, "default");
  assert.deepEqual(lock.integration, {
    id: "j3w1-site-legacy-css-vars",
    version: "1",
    kind: "css-vars",
  });
  assert.equal(lock.exports[THEME_EXPORT], EXPECTED_DIGEST);
  assert.deepEqual(lock.components, []);
  assert.deepEqual(lock.deviations, []);
});

test("the vendored v0.1.0 export has the published bytes and digest", async () => {
  const vendor = await read(...THEME_VENDOR_FILE.split("/"));
  assert.equal(vendor.length, 13_423);
  assert.equal(vendor.includes(Buffer.from("\r\n")), false, "vendored theme must use LF");
  assert.equal(themeDigest(vendor), EXPECTED_DIGEST);
});

test("the default profile generates 37 aliases and changes only quiet", async () => {
  const lock = JSON.parse(await read(THEME_LOCK_FILE));
  const vendor = await read(...THEME_VENDOR_FILE.split("/"));
  const parsed = parseDefaultColorProperties(vendor);
  assert.equal(parsed.get("--color-text-subtle"), "#ad7175");
  assert.ok(
    vendor.toString("utf8").includes("[data-profile=\"heritage-ansi\"]") &&
      vendor.toString("utf8").includes("--color-text-subtle: #a3676b"),
    "fixture must exercise a profile override of text.subtle",
  );

  const generated = buildThemeCss(vendor, lock);
  const mapped = declarations(generated);
  assert.equal(LEGACY_THEME_MAP.length, 37);
  assert.equal(mapped.size, 37);
  assert.ok(Buffer.byteLength(generated, "utf8") < 1024, "generated block must stay below 1 KiB");
  assert.equal(mapped.has("--xbg"), false);
  assert.equal(mapped.has("--xfg"), false);

  const changes = Object.entries(PRE_ADOPTION_VALUES)
    .filter(([name, before]) => mapped.get(name) !== before)
    .map(([name, before]) => ({ name, before, after: mapped.get(name) }));
  assert.deepEqual(changes, [
    { name: "--quiet", before: "#a3676b", after: "#ad7175" },
  ]);
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
    "--xbg: #0c0909;",
    "--xfg: #e99499;",
    "--bar-height: 28px;",
    "--font-size-term: 13px;",
    "--gaps-outer: -2px;",
    "--font:",
  ]) {
    assert.ok(authored.includes(line), "hand-authored root is missing " + line);
  }
  assert.doesNotMatch(authored, /^\s*--quiet:/m);
  assert.doesNotMatch(authored, /^\s*--color15:/m);
});

test("theme parsing and validation fail closed", async () => {
  assert.throws(
    () => parseDefaultColorProperties(":root {\n  --color-a: #000000;\n  --color-a: #111111;\n}\n"),
    /repeats --color-a/,
  );
  assert.throws(
    () => parseDefaultColorProperties("[data-profile=\"default\"] {\n  --color-a: #000000;\n}\n"),
    /exactly one default :root/,
  );

  const lock = JSON.parse(await read(THEME_LOCK_FILE));
  const vendor = await read(...THEME_VENDOR_FILE.split("/"));
  assert.throws(
    () => buildThemeCss(vendor, {
      ...lock,
      exports: { [THEME_EXPORT]: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    }),
    /does not match the pinned/,
  );
  assert.throws(() => parseThemeRef("main"), /release tag.*full lowercase commit/);
  assert.equal(parseThemeRef("v0.1.0"), "v0.1.0");
  assert.equal(parseThemeRef(EXPECTED_REVISION), EXPECTED_REVISION);
});

test("the updater dereferences annotated tags to commits", async () => {
  const tagObject = "d5b660dd576916e81cd5122589df584d2e9c01cc";
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
    await resolveThemeRevision("v0.1.0", { fetchImpl }),
    EXPECTED_REVISION,
  );
  assert.equal(requested.length, 2);
  assert.match(requested[0], /\/git\/ref\/tags\/v0\.1\.0$/);
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
