/* Generates the site's legacy colour variables from a committed, pinned
   j3w1/theme export. The export is an input, not a runtime stylesheet: GitHub
   Pages still serves the generated site.css verbatim and generation/checking
   never needs the network. */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const THEME_LOCK_FILE = "theme.lock.json";
export const THEME_EXPORT = "exports/tokens.css";
export const THEME_VENDOR_FILE = "vendor/j3w1-theme/exports/tokens.css";
export const THEME_START = "/* @generated-theme:start */";
export const THEME_END = "/* @generated-theme:end */";

/* The consumer-owned bridge from the site's historical variable names to the
   approved default profile. Its provenance is
   j3w1/theme references/j3w1-web/mapping.json at the pinned revision. */
export const LEGACY_THEME_MAP = [
  ["--desktop", "--color-surface-desktop"],
  ["--terminal", "--color-surface-canvas"],
  ["--chrome", "--color-surface-chrome"],
  ["--chrome-alt", "--color-surface-chrome-alt"],
  ["--surface", "--color-surface-default"],
  ["--surface-raised", "--color-surface-raised"],
  ["--selection", "--color-interaction-selection-bg"],
  ["--selection-dark", "--color-interaction-hover-bg-strong"],
  ["--selection-soft", "--color-interaction-selection-inactive-bg"],
  ["--button", "--color-action-primary-bg"],
  ["--focus", "--color-interaction-focus-ring"],
  ["--focus-dim", "--color-text-link-underline"],
  ["--foreground", "--color-text-default"],
  ["--foreground-bright", "--color-text-bright"],
  ["--prose", "--color-text-prose"],
  ["--muted", "--color-text-muted"],
  ["--quiet", "--color-text-subtle"],
  ["--inactive", "--color-border-disabled"],
  ["--border", "--color-border-default"],
  ["--border-strong", "--color-border-strong"],
  ["--border-active", "--color-border-active"],
  ...Array.from({ length: 16 }, (_, index) => [
    "--color" + index,
    "--color-primitive-ansi-" + index,
  ]),
];

const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const REVISION_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256-[A-Za-z0-9+/]+={0,2}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const LOCK_KEYS = [
  "schemaVersion",
  "theme",
  "version",
  "ref",
  "revision",
  "profile",
  "integration",
  "resolvedAt",
  "exports",
  "components",
  "deviations",
];

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requireExactKeys = (value, expected, label) => {
  invariant(isObject(value), label + " must be an object");
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  invariant(
    actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    label + " must contain exactly: " + wanted.join(", "),
  );
};

export const normalizeThemeText = (input) => {
  const text = typeof input === "string"
    ? input
    : new TextDecoder("utf-8", { fatal: true }).decode(input);
  return text.replace(/\r\n?/g, "\n");
};

export const themeDigest = (input) =>
  "sha256-" + createHash("sha256")
    .update(Buffer.from(normalizeThemeText(input), "utf8"))
    .digest("base64");

export const validateThemeLock = (lock) => {
  requireExactKeys(lock, LOCK_KEYS, THEME_LOCK_FILE);
  invariant(lock.schemaVersion === 1, "theme lock schemaVersion must be 1");
  invariant(lock.theme === "j3w1-theme", "theme lock must name j3w1-theme");
  invariant(
    typeof lock.version === "string" &&
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(lock.version),
    "theme lock has an invalid version",
  );
  invariant(
    typeof lock.ref === "string" &&
      (TAG_PATTERN.test(lock.ref) || REVISION_PATTERN.test(lock.ref)),
    "theme lock ref must be a release tag or full commit",
  );
  invariant(
    typeof lock.revision === "string" && REVISION_PATTERN.test(lock.revision),
    "theme lock revision must be a full lowercase commit",
  );
  invariant(lock.profile === "default", "theme integration requires the default profile");

  requireExactKeys(lock.integration, ["id", "version", "kind"], "theme lock integration");
  invariant(
    lock.integration.id === "j3w1-site-legacy-css-vars",
    "theme lock has the wrong integration id",
  );
  invariant(lock.integration.version === "1", "theme lock integration version must be 1");
  invariant(lock.integration.kind === "css-vars", "theme lock integration kind must be css-vars");
  invariant(
    typeof lock.resolvedAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(lock.resolvedAt) &&
      !Number.isNaN(Date.parse(lock.resolvedAt)),
    "theme lock resolvedAt must be a UTC date-time",
  );

  requireExactKeys(lock.exports, [THEME_EXPORT], "theme lock exports");
  invariant(
    typeof lock.exports[THEME_EXPORT] === "string" &&
      DIGEST_PATTERN.test(lock.exports[THEME_EXPORT]),
    "theme lock tokens.css digest is invalid",
  );
  invariant(Array.isArray(lock.components) && lock.components.length === 0, "theme lock components must be empty");
  invariant(Array.isArray(lock.deviations) && lock.deviations.length === 0, "theme lock deviations must be empty");
  return lock;
};

export const parseDefaultColorProperties = (css) => {
  const source = normalizeThemeText(css);
  const roots = [...source.matchAll(/(?:^|\n):root\s*\{/g)];
  invariant(roots.length === 1, "vendored tokens.css must contain exactly one default :root block");
  const open = source.indexOf("{", roots[0].index);
  const close = source.indexOf("}", open + 1);
  invariant(close > open, "vendored tokens.css has an unterminated default :root block");

  const properties = new Map();
  const body = source.slice(open + 1, close);
  for (const match of body.matchAll(/^\s*(--color-[a-z0-9-]+)\s*:\s*([^;]+);\s*$/gm)) {
    const [, name, rawValue] = match;
    invariant(!properties.has(name), "vendored default profile repeats " + name);
    properties.set(name, rawValue.trim());
  }
  return properties;
};

export const buildThemeCss = (vendorCss, lock) => {
  validateThemeLock(lock);
  const actualDigest = themeDigest(vendorCss);
  const expectedDigest = lock.exports[THEME_EXPORT];
  invariant(
    actualDigest === expectedDigest,
    "vendored " + THEME_EXPORT + " digest " + actualDigest +
      " does not match the pinned " + expectedDigest,
  );

  const properties = parseDefaultColorProperties(vendorCss);
  const declarations = LEGACY_THEME_MAP.map(([legacy, token]) => {
    const value = properties.get(token);
    invariant(value !== undefined, "vendored default profile is missing " + token);
    invariant(COLOR_PATTERN.test(value), token + " must resolve to a lowercase six-digit hex colour");
    return "  " + legacy + ": " + value + ";";
  });

  return [
    THEME_START,
    "/* j3w1-theme " + lock.ref + "/" + lock.profile + "; generated by scripts/generate.mjs. */",
    ":root {",
    ...declarations,
    "}",
    THEME_END,
  ].join("\n");
};

export const replaceThemeBlock = (siteCss, generated) => {
  const source = normalizeThemeText(siteCss);
  const start = source.indexOf(THEME_START);
  const end = source.indexOf(THEME_END);
  invariant(start >= 0 && end > start, "site.css must contain the generated theme markers");
  invariant(
    start === source.lastIndexOf(THEME_START) && end === source.lastIndexOf(THEME_END),
    "site.css must contain exactly one generated theme block",
  );
  return source.slice(0, start) + generated + source.slice(end + THEME_END.length);
};

export const themeGenerator = {
  name: "theme",
  async run({ repoRoot, check }) {
    let lock;
    try {
      lock = JSON.parse(await fs.readFile(path.join(repoRoot, THEME_LOCK_FILE), "utf8"));
    } catch (error) {
      throw new Error("could not read " + THEME_LOCK_FILE + ": " + error.message);
    }
    const vendorCss = await fs.readFile(path.join(repoRoot, THEME_VENDOR_FILE));
    const generated = buildThemeCss(vendorCss, lock);
    const target = path.join(repoRoot, "assets/css/site.css");
    const current = await fs.readFile(target, "utf8");
    const next = replaceThemeBlock(current, generated);
    if (next === normalizeThemeText(current)) {
      return LEGACY_THEME_MAP.length + " aliases from " + lock.ref;
    }
    if (check) throw new Error("stale: assets/css/site.css — run npm run generate");
    await fs.writeFile(target, next);
    return LEGACY_THEME_MAP.length + " aliases from " + lock.ref + " (assets/css/site.css written)";
  },
};
