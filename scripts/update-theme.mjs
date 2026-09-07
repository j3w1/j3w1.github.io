#!/usr/bin/env node
/* Explicitly refreshes the committed j3w1/theme input. This is the only theme
   integration command that uses the network; generate and check consume the
   validated local copy. Usage:

     npm run update-theme -- v0.1.0
     npm run update-theme -- <full-commit>
*/

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  normalizeThemeText,
  THEME_EXPORT,
  THEME_LOCK_FILE,
  THEME_VENDOR_FILE,
  themeDigest,
  validateThemeLock,
} from "./lib/theme.mjs";

const REPOSITORY = "j3w1/theme";
const API_BASE = "https://api.github.com/repos/" + REPOSITORY;
const RAW_BASE = "https://raw.githubusercontent.com/" + REPOSITORY;
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const REVISION_PATTERN = /^[0-9a-f]{40}$/;

export const parseThemeRef = (value) => {
  if (typeof value !== "string" || (!TAG_PATTERN.test(value) && !REVISION_PATTERN.test(value))) {
    throw new Error("theme ref must be a release tag such as v0.1.0 or a full lowercase commit");
  }
  return value;
};

const request = async (url, fetchImpl) => {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "j3w1.github.io-theme-updater",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error("could not fetch " + url + ": HTTP " + response.status);
  return response;
};

const requestJson = async (url, fetchImpl) => {
  const response = await request(url, fetchImpl);
  try {
    return JSON.parse(await response.text());
  } catch (error) {
    throw new Error("could not parse " + url + ": " + error.message);
  }
};

export const resolveThemeRevision = async (ref, { fetchImpl = fetch } = {}) => {
  parseThemeRef(ref);
  if (REVISION_PATTERN.test(ref)) return ref;

  const tagRef = await requestJson(API_BASE + "/git/ref/tags/" + encodeURIComponent(ref), fetchImpl);
  let object = tagRef.object;
  for (let depth = 0; object?.type === "tag" && depth < 5; depth += 1) {
    const tag = await requestJson(API_BASE + "/git/tags/" + object.sha, fetchImpl);
    object = tag.object;
  }
  if (object?.type !== "commit" || !REVISION_PATTERN.test(object.sha ?? "")) {
    throw new Error("theme tag " + ref + " did not resolve to a full commit");
  }
  return object.sha;
};

const approvedDefaultProfile = (manifest) =>
  Array.isArray(manifest.profiles) &&
  manifest.profiles.find((profile) =>
    profile?.id === "default" && profile.default === true && profile.status === "approved"
  );

export const fetchPinnedTheme = async (
  ref,
  { fetchImpl = fetch, now = () => new Date() } = {},
) => {
  parseThemeRef(ref);
  const revision = await resolveThemeRevision(ref, { fetchImpl });
  const raw = RAW_BASE + "/" + revision + "/";
  const [manifest, digests, cssResponse] = await Promise.all([
    requestJson(raw + "theme.json", fetchImpl),
    requestJson(raw + "exports/digests.json", fetchImpl),
    request(raw + THEME_EXPORT, fetchImpl),
  ]);
  const css = normalizeThemeText(await cssResponse.arrayBuffer());
  const canonicalCss = Buffer.from(css, "utf8");

  if (manifest?.name !== "j3w1-theme" || manifest?.schemaVersion !== 1) {
    throw new Error("theme manifest does not describe j3w1-theme schema version 1");
  }
  if (
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
  ) {
    throw new Error("theme manifest has an invalid version");
  }
  if (TAG_PATTERN.test(ref) && ref !== "v" + manifest.version) {
    throw new Error("theme tag " + ref + " contains manifest version " + manifest.version);
  }
  if (!approvedDefaultProfile(manifest)) {
    throw new Error("theme manifest does not have an approved default profile");
  }
  if (
    digests?.schemaVersion !== 1 ||
    digests?.theme !== "j3w1-theme" ||
    digests?.version !== manifest.version
  ) {
    throw new Error("theme digest manifest does not match theme.json");
  }
  const expectedDigest = digests.files?.[THEME_EXPORT];
  const actualDigest = themeDigest(canonicalCss);
  if (typeof expectedDigest !== "string" || actualDigest !== expectedDigest) {
    throw new Error(
      "fetched " + THEME_EXPORT + " digest " + actualDigest +
        " does not match the published " + (expectedDigest ?? "(missing)"),
    );
  }

  const resolvedAt = now().toISOString();
  const lock = {
    schemaVersion: 1,
    theme: "j3w1-theme",
    version: manifest.version,
    ref,
    revision,
    profile: "default",
    integration: {
      id: "j3w1-site-legacy-css-vars",
      version: "1",
      kind: "css-vars",
    },
    resolvedAt,
    exports: {
      [THEME_EXPORT]: expectedDigest,
    },
    components: [],
    deviations: [],
  };
  validateThemeLock(lock);
  return { css: canonicalCss, lock };
};

const readExisting = async (file) => {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const samePin = (previous, next) =>
  previous?.schemaVersion === next.schemaVersion &&
  previous?.theme === next.theme &&
  previous?.version === next.version &&
  previous?.ref === next.ref &&
  previous?.revision === next.revision &&
  previous?.profile === next.profile &&
  previous?.exports?.[THEME_EXPORT] === next.exports[THEME_EXPORT];

const writeIfChanged = async (file, next) => {
  const current = await readExisting(file);
  if (current?.equals(next)) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next);
  return true;
};

export const updateTheme = async (
  repoRoot,
  ref,
  { fetchImpl = fetch, now = () => new Date() } = {},
) => {
  const fetched = await fetchPinnedTheme(ref, { fetchImpl, now });
  const lockPath = path.join(repoRoot, THEME_LOCK_FILE);
  const vendorPath = path.join(repoRoot, THEME_VENDOR_FILE);
  let previous = null;
  try {
    previous = JSON.parse(await fs.readFile(lockPath, "utf8"));
    validateThemeLock(previous);
  } catch {
    /* A missing or malformed lock is replaced only after the new pin validates. */
    previous = null;
  }
  if (samePin(previous, fetched.lock) && typeof previous.resolvedAt === "string") {
    fetched.lock.resolvedAt = previous.resolvedAt;
  }
  validateThemeLock(fetched.lock);

  const nextLock = Buffer.from(JSON.stringify(fetched.lock, null, 2) + "\n", "utf8");
  const vendorChanged = await writeIfChanged(vendorPath, fetched.css);
  const lockChanged = await writeIfChanged(lockPath, nextLock);
  return {
    lock: fetched.lock,
    changed: [
      ...(vendorChanged ? [THEME_VENDOR_FILE] : []),
      ...(lockChanged ? [THEME_LOCK_FILE] : []),
    ],
  };
};

const isMain = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    if (process.argv.length !== 3) {
      throw new Error("usage: npm run update-theme -- <release-tag-or-full-commit>");
    }
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const result = await updateTheme(repoRoot, process.argv[2]);
    console.log(
      "pinned j3w1-theme " + result.lock.ref + " @ " + result.lock.revision +
        (result.changed.length ? ": wrote " + result.changed.join(", ") : ": already current"),
    );
  } catch (error) {
    console.error("update-theme: " + error.message);
    process.exitCode = 1;
  }
}
