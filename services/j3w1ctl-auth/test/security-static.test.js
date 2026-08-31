import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const filesUnder = async (directory) => {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(target));
    else result.push(target);
  }
  return result;
};

test("browser bundles, configuration, and deployment examples contain no credential material", async () => {
  const candidates = [
    ...await filesUnder(path.join(repoRoot, "admin")),
    ...await filesUnder(path.join(repoRoot, "assets", "js")),
    path.join(repoRoot, "services", "j3w1ctl-auth", ".env.example"),
  ];
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{80,}\r?\n-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\b(?:eyJ[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}\b/,
  ];
  for (const file of candidates) {
    const source = await fs.readFile(file, "utf8");
    for (const pattern of forbidden) assert.equal(pattern.test(source), false, `${path.relative(repoRoot, file)} matched ${pattern}`);
  }
  const configSource = await fs.readFile(path.join(repoRoot, "admin", "config.js"), "utf8");
  const configMatch = configSource.match(/^\s*window\.J3W1CTL_CONFIG\s*=\s*Object\.freeze\(\{\s*apiBaseUrl:\s*"([^"]*)",\s*\}\);\s*$/s);
  assert.ok(configMatch, "admin/config.js must contain only the public API base URL");
  if (configMatch[1]) {
    const apiBaseUrl = new URL(configMatch[1]);
    assert.equal(apiBaseUrl.protocol, "https:");
    assert.equal(apiBaseUrl.username, "");
    assert.equal(apiBaseUrl.password, "");
    assert.equal(apiBaseUrl.pathname, "/");
    assert.equal(apiBaseUrl.search, "");
    assert.equal(apiBaseUrl.hash, "");
  }
});

test("browser OAuth handoff keeps exact origin, source, type, and channel checks", async () => {
  const source = await fs.readFile(path.join(repoRoot, "admin", "j3w1ctl.js"), "utf8");
  assert.match(source, /event\.origin !== this\.apiBase/);
  assert.match(source, /event\.source !== this\.popup/);
  assert.match(source, /event\.data\?\.channel !== channel/);
  assert.match(source, /\["j3w1ctl:auth-success", "j3w1ctl:auth-error"\]\.includes\(event\.data\?\.type\)/);
  assert.match(source, /sessionStorage\.setItem\(TOKEN_KEY, this\.token\)/);
});

test("server logging excludes request secrets, bodies, query values, and photograph bytes", async () => {
  const source = await fs.readFile(path.join(repoRoot, "services", "j3w1ctl-auth", "src", "server.js"), "utf8");
  assert.match(source, /redact: \["req\.headers", "req\.query", "req\.body", "res\.headers"\]/);
  assert.match(source, /url: String\(request\.url \?\? ""\)\.split\("\?", 1\)\[0\]/);
  assert.doesNotMatch(source, /request\.log\.(?:info|warn|error)\([^\n]*(?:headers|query|body|cookie|token|blob|photo)/i);
});

test("direct and i3bar launchers use the same CMS bundle cache key", async () => {
  const adminIndex = await fs.readFile(path.join(repoRoot, "admin", "index.html"), "utf8");
  const publicSite = await fs.readFile(path.join(repoRoot, "assets", "js", "site.js"), "utf8");
  const adminVersion = adminIndex.match(/\/admin\/j3w1ctl\.js\?v=([A-Za-z0-9.-]+)/)?.[1];
  const publicVersion = publicSite.match(/\/admin\/j3w1ctl\.js\?v=([A-Za-z0-9.-]+)/)?.[1];
  assert.ok(adminVersion);
  assert.equal(publicVersion, adminVersion);
});

test("CMS integration locks mutations, uses semantic editor sizing, and uploads generated WebP only", async () => {
  const source = await fs.readFile(path.join(repoRoot, "admin", "j3w1ctl.js"), "utf8");
  const imageSource = await fs.readFile(path.join(repoRoot, "admin", "j3w1ctl-images.js"), "utf8");
  const css = await fs.readFile(path.join(repoRoot, "admin", "j3w1ctl.css"), "utf8");
  assert.match(source, /if \(this\.loading\.inFlight\) return false;\s+if \(!this\.mutation\.enter\(action\)\) return false;/);
  assert.match(source, /finally \{ this\.endMutation\(\); \}/);
  assert.match(source, /setAttribute\("aria-busy", "true"\)/);
  assert.match(source, /control\.disabled = true/);
  assert.match(source, /ctl-textarea-summary/);
  assert.match(source, /ctl-textarea-body/);
  assert.match(source, /uploadPrivateBlob\(target\[kind\], pair\[kind\]/);
  assert.match(source, /access: "private"/);
  assert.match(source, /imageIds: staged\.map/);
  assert.match(source, /preserveBatch = error\?\.code === "publication_unknown"/);
  assert.doesNotMatch(source, /uploadPrivateBlob\([^\n]*(?:source|original)/);
  assert.match(imageSource, /imageOrientation: "from-image"/);
  assert.match(imageSource, /blob\.type !== "image\/webp"/);
  assert.match(css, /:is\(input,textarea,select,button\):disabled/);
  assert.match(css, /\.ctl-textarea-body \{ min-height: 380px; \}/);
  assert.match(css, /\.ctl-textarea-summary \{ min-height: 66px; \}/);
});

test("public photo viewer close is route-neutral, backdrop-scoped, and focus-restoring", async () => {
  const source = await fs.readFile(path.join(repoRoot, "assets", "js", "public-content.js"), "utf8");
  const closeBlock = source.match(/const closePhoto = \(\) => \{[\s\S]*?\n\};/)?.[0] ?? "";
  assert.match(closeBlock, /closePhotoViewer\(dialog, returnFocus\)/);
  assert.doesNotMatch(closeBlock, /history\.|location\.|hashchange/i);
  assert.match(source, /openPhoto\(target, image, button\)/);
  assert.match(source, /isPhotoViewerBackdropClick\(event\)/);
});

test("project table keeps its number column fixed while remaining columns absorb width", async () => {
  const html = await fs.readFile(path.join(repoRoot, "index.html"), "utf8");
  const css = await fs.readFile(path.join(repoRoot, "assets", "css", "site.css"), "utf8");
  assert.match(html, /<col class="project-col-number">/);
  assert.match(html, /<col class="project-col-repository">/);
  assert.match(css, /\.project-table \.project-col-number \{ width: 38px; \}/);
  assert.match(css, /\.project-table \.project-col-repository \{ width: auto; \}/);
});

test("CMS foreground reads use a distinct loading gate and photography preview renders image sources", async () => {
  const source = await fs.readFile(path.join(repoRoot, "admin", "j3w1ctl.js"), "utf8");
  const css = await fs.readFile(path.join(repoRoot, "admin", "j3w1ctl.css"), "utf8");
  assert.match(source, /this\.loading = new ActivityGate\(\)/);
  assert.match(source, /const activity = this\.beginLoading\(`reading \$\{name\}`\)/);
  assert.match(source, /finally \{ this\.endLoading\(activity\); \}/);
  assert.match(source, /renderPhotographyPreview\(result\.metadata\)/);
  assert.match(source, /buildPhotographyPreviewItems\(/);
  assert.match(source, /createObjectUrl: \(blob\) => this\.photoPreviewUrls\.create\(blob\)/);
  assert.match(source, /this\.photoPreviewUrls\.revokeAll\(\)/);
  assert.match(css, /\.is-loading-locked/);
  assert.match(css, /\.ctl-photo-preview-item img/);
});
