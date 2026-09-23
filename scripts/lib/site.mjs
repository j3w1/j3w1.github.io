/* Identity, the projects table, the link list and the about buffers are data:
   content/site.json is authoritative, and this generator writes the marked
   regions of index.html, wiki/index.html and 404.html from it, the way the
   preload list and the theme block are written. The HTML stays static and
   crawlable; only its provenance changes. `npm run check` fails on drift, and
   also proves that the page generator's own constants (the author, origin and
   theme colour the entry pages carry) and site.webmanifest still agree with
   the data. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { AUTHOR, DEFAULT_SOCIAL_IMAGE, SITE_NAME, SITE_ORIGIN, THEME_COLOR } from "../../services/j3w1ctl-auth/src/site-pages.js";
import * as templates from "./site-templates.mjs";
import { parseDefaultProperties, THEME_VENDOR_FILE } from "./theme.mjs";

export const SITE_FILE = "content/site.json";
export const marker = (block, edge) => `<!-- @generated-site:${block}:${edge} -->`;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HTTPS = /^https:\/\/[^\s"<>]+$/;
const SITE_PATH = /^\/[^\s"<>]*$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/;

const fail = (where, message) => {
  throw new Error(`${SITE_FILE}: ${where} ${message}`);
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const exactKeys = (value, keys, where) => {
  if (!isObject(value)) fail(where, "must be an object");
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(where, `must contain exactly: ${wanted.join(", ")}`);
  }
};

const nonEmpty = (value, where) => {
  if (typeof value !== "string" || value.trim() === "" || /[\n\r]/.test(value)) fail(where, "must be a single non-empty line");
};

const stringList = (value, where, { min = 1 } = {}) => {
  if (!Array.isArray(value) || value.length < min) fail(where, `must list at least ${min}`);
  value.forEach((item, index) => nonEmpty(item, `${where}[${index}]`));
};

const unique = (values, where) => {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(where, `repeats ${value}`);
    seen.add(value);
  }
};

export const validateSite = (site) => {
  exactKeys(site, ["schemaVersion", "site", "identity", "home", "about", "elsewhere", "projects"], "root");
  if (site.schemaVersion !== 1) fail("schemaVersion", "must be 1");

  exactKeys(site.site, ["name", "origin", "image", "themeColor", "description"], "site");
  nonEmpty(site.site.name, "site.name");
  if (!HTTPS.test(site.site.origin) || site.site.origin.endsWith("/")) fail("site.origin", "must be an https origin without a trailing slash");
  if (!SITE_PATH.test(site.site.image)) fail("site.image", "must be a site-absolute path");
  if (!HEX_COLOR.test(site.site.themeColor)) fail("site.themeColor", "must be a lowercase six-digit hex colour");
  nonEmpty(site.site.description, "site.description");

  exactKeys(site.identity, ["name", "alternateName", "role", "description", "jobTitle", "github", "sameAs"], "identity");
  for (const key of ["name", "alternateName", "role", "description"]) nonEmpty(site.identity[key], `identity.${key}`);
  stringList(site.identity.jobTitle, "identity.jobTitle");
  if (!HTTPS.test(site.identity.github)) fail("identity.github", "must be an https URL");
  stringList(site.identity.sameAs, "identity.sameAs");
  site.identity.sameAs.forEach((url, index) => { if (!HTTPS.test(url)) fail(`identity.sameAs[${index}]`, "must be an https URL"); });

  exactKeys(site.home, ["readme", "focus"], "home");
  stringList(site.home.readme, "home.readme");
  if (!Array.isArray(site.home.focus) || site.home.focus.length === 0) fail("home.focus", "must list at least 1");
  site.home.focus.forEach((item, index) => {
    exactKeys(item, ["name", "text"], `home.focus[${index}]`);
    if (!/^[a-z]+$/.test(item.name)) fail(`home.focus[${index}].name`, "must be lowercase letters");
    nonEmpty(item.text, `home.focus[${index}].text`);
  });
  unique(site.home.focus.map((item) => item.name), "home.focus");

  exactKeys(site.about, ["paragraphs", "interests"], "about");
  stringList(site.about.paragraphs, "about.paragraphs");
  if (!Array.isArray(site.about.interests) || site.about.interests.length === 0) fail("about.interests", "must list at least 1");
  site.about.interests.forEach((item, index) => {
    exactKeys(item, ["label", "text"], `about.interests[${index}]`);
    nonEmpty(item.label, `about.interests[${index}].label`);
    nonEmpty(item.text, `about.interests[${index}].text`);
  });

  exactKeys(site.elsewhere, ["links", "note"], "elsewhere");
  nonEmpty(site.elsewhere.note, "elsewhere.note");
  if (!Array.isArray(site.elsewhere.links) || site.elsewhere.links.length === 0) fail("elsewhere.links", "must list at least 1");
  site.elsewhere.links.forEach((link, index) => {
    const where = `elsewhere.links[${index}]`;
    const keys = Object.keys(link);
    exactKeys(link, ["name", "href", ...(keys.includes("label") ? ["label"] : []), ...(keys.includes("rel") ? ["rel"] : [])], where);
    if (!/^[a-z0-9-]+$/.test(link.name)) fail(`${where}.name`, "must be a lowercase slug");
    if (!HTTPS.test(link.href) && !SITE_PATH.test(link.href)) fail(`${where}.href`, "must be https or site-absolute");
    if (link.label !== undefined) nonEmpty(link.label, `${where}.label`);
    if (link.rel !== undefined && link.rel !== "me") fail(`${where}.rel`, "may only be \"me\"");
  });
  unique(site.elsewhere.links.map((link) => link.name), "elsewhere.links");

  exactKeys(site.projects, ["selected", "entries"], "projects");
  if (!Array.isArray(site.projects.entries) || site.projects.entries.length === 0) fail("projects.entries", "must list at least 1");
  site.projects.entries.forEach((project, index) => {
    const where = `projects.entries[${index}]`;
    exactKeys(project, ["id", "name", "stack", "state", "visibility", "repository", "summary", "facts"], where);
    if (!SLUG.test(project.id)) fail(`${where}.id`, "must be a lowercase slug");
    for (const key of ["name", "stack", "state", "summary"]) nonEmpty(project[key], `${where}.${key}`);
    if (!["public", "internal"].includes(project.visibility)) fail(`${where}.visibility`, "must be public or internal");
    if (project.repository !== null && !HTTPS.test(project.repository)) fail(`${where}.repository`, "must be an https URL or null");
    if (project.visibility === "internal" && project.repository !== null) fail(`${where}.repository`, "must be null for an internal project");
    if (!Array.isArray(project.facts)) fail(`${where}.facts`, "must be a list");
    project.facts.forEach((fact, factIndex) => {
      if (!Array.isArray(fact) || fact.length !== 2) fail(`${where}.facts[${factIndex}]`, "must be a [key, value] pair");
      nonEmpty(fact[0], `${where}.facts[${factIndex}][0]`);
      nonEmpty(fact[1], `${where}.facts[${factIndex}][1]`);
    });
  });
  unique(site.projects.entries.map((project) => project.id), "projects.entries");
  if (!site.projects.entries.some((project) => project.id === site.projects.selected)) {
    fail("projects.selected", `names no project (${site.projects.selected})`);
  }
  return site;
};

export const readSite = async (repoRoot) => {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(path.join(repoRoot, SITE_FILE), "utf8"));
  } catch (error) {
    throw new Error(`could not read ${SITE_FILE}: ${error.message}`);
  }
  return validateSite(parsed);
};

/* Every generated block, keyed by page and block name. */
export const renderSiteBlocks = (site) => ({
  "index.html": {
    meta: templates.meta(site),
    "head-shared": templates.headShared(),
    jsonld: templates.structuredData(site),
    "home-terminal": templates.homeTerminal(site),
    "home-files": templates.homeFiles(site),
    projects: templates.projects(site),
    elsewhere: templates.elsewhere(site),
    about: templates.about(site),
  },
  "wiki/index.html": {
    "head-shared": templates.headShared(),
    "page-bar": templates.pageBar({ label: "wiki", desktopHref: "/#home" }),
    "page-foot": templates.pageFoot(),
  },
  "404.html": {
    "head-shared": templates.headShared(),
    "page-bar": templates.pageBar({ label: "404", desktopHref: "/#home" }),
    "page-foot": templates.pageFoot(),
  },
});

/* Replaces the content between each block's markers; a page must carry every
   block exactly once. Pure: returns the next text. */
export const applyBlocks = (html, blocks, page = "page") => {
  let next = html.replaceAll("\r\n", "\n");
  for (const [name, rendered] of Object.entries(blocks)) {
    const start = marker(name, "start");
    const end = marker(name, "end");
    const startAt = next.indexOf(start);
    const endAt = next.indexOf(end);
    if (startAt < 0 || endAt < 0) throw new Error(`${page} is missing the ${name} markers`);
    if (endAt < startAt) throw new Error(`${page} has the ${name} markers reversed`);
    if (next.indexOf(start, startAt + 1) >= 0 || next.indexOf(end, endAt + 1) >= 0) {
      throw new Error(`${page} has more than one ${name} block`);
    }
    next = next.slice(0, startAt + start.length) + "\n" + rendered + "\n" + next.slice(endAt - leadingIndent(next, endAt).length);
  }
  return next;
};

const leadingIndent = (source, at) => {
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  const prefix = source.slice(lineStart, at);
  return /^[ \t]*$/.test(prefix) ? prefix : "";
};

/* The values other files repeat and must keep in step with the data. */
export const parityProblems = async (repoRoot, site) => {
  const problems = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) problems.push(`${label}: ${JSON.stringify(actual)} should be ${JSON.stringify(wanted)}`);
  };
  expect("site-pages.js SITE_NAME", SITE_NAME, site.site.name);
  expect("site-pages.js SITE_ORIGIN", SITE_ORIGIN, site.site.origin);
  expect("site-pages.js DEFAULT_SOCIAL_IMAGE", DEFAULT_SOCIAL_IMAGE, templates.socialImage(site));
  expect("site-pages.js THEME_COLOR", THEME_COLOR, site.site.themeColor);
  expect("site-pages.js AUTHOR.name", AUTHOR.name, site.identity.name);
  expect("site-pages.js AUTHOR.alternateName", AUTHOR.alternateName, site.identity.alternateName);
  expect("site-pages.js AUTHOR.url", AUTHOR.url, `${site.site.origin}/`);
  expect("site-pages.js AUTHOR.github", AUTHOR.github, site.identity.github);

  const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, "site.webmanifest"), "utf8"));
  expect("site.webmanifest short_name", manifest.short_name, site.site.name);
  expect("site.webmanifest description", manifest.description, site.site.description);
  expect("site.webmanifest theme_color", manifest.theme_color, site.site.themeColor);
  expect("site.webmanifest background_color", manifest.background_color, site.site.themeColor);

  const tokens = parseDefaultProperties(await fs.readFile(path.join(repoRoot, THEME_VENDOR_FILE)));
  expect("theme canvas (--color-surface-canvas)", tokens.get("--color-surface-canvas"), site.site.themeColor);
  return problems;
};

export const siteGenerator = {
  name: "site identity, projects and page shell",
  async run({ repoRoot, check }) {
    const site = await readSite(repoRoot);
    const problems = await parityProblems(repoRoot, site);
    if (problems.length) throw new Error(`content/site.json disagrees with:\n  ${problems.join("\n  ")}`);

    const written = [];
    for (const [page, blocks] of Object.entries(renderSiteBlocks(site))) {
      const file = path.join(repoRoot, page);
      const current = await fs.readFile(file, "utf8");
      const next = applyBlocks(current, blocks, page);
      if (next === current.replaceAll("\r\n", "\n")) continue;
      if (check) throw new Error(`stale: ${page} — run npm run generate`);
      await fs.writeFile(file, next);
      written.push(page);
    }
    const blocks = Object.values(renderSiteBlocks(site)).reduce((total, page) => total + Object.keys(page).length, 0);
    return `${blocks} blocks from ${SITE_FILE}${written.length ? ` (${written.join(", ")} written)` : ""}`;
  },
};
