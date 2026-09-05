/* Mechanical enforcement of the window manager's accessibility and structure
   contract. These are the rules that are cheap to break silently and expensive
   to notice: see docs/wm-accessibility.md for the reasoning behind each one. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { collectTokens } from "../scripts/lib/cache-tokens.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFile(path.join(repoRoot, ...parts), "utf8");

test("index.html never uses a positive tabindex or role=application", async () => {
  const html = await read("index.html");
  /* A positive tabindex reorders the whole document's tab sequence, and
     role="application" swallows a screen reader's virtual cursor entirely. */
  assert.doesNotMatch(html, /tabindex="[1-9]/, "positive tabindex found");
  assert.doesNotMatch(html, /role="application"/, "role=application found");
  assert.doesNotMatch(html, /aria-modal=/, "aria-modal outside <dialog> found");
});

test("the lock screen and toasts are inert and hidden from assistive tech", async () => {
  const html = await read("index.html");
  /* Both are purely visual: they must never take focus or reach a screen reader. */
  for (const id of ["lockscreen", "dunst"]) {
    const element = html.match(new RegExp(`<div id="${id}"[^>]*>`))?.[0];
    assert.ok(element, `#${id} is missing`);
    assert.match(element, /aria-hidden="true"/, `#${id} must be aria-hidden`);
    assert.match(element, /\binert\b/, `#${id} must be inert`);
  }
});

test("the greeter is an announced dialog with a real, reachable login control", async () => {
  const html = await read("index.html");
  const element = html.match(/<div id="greeter"[^>]*>/)?.[0];
  assert.ok(element, "#greeter is missing");
  /* It waits for a genuine login, so unlike the lock screen it must be
     operable: inert or aria-hidden here would make it impossible to use. */
  assert.doesNotMatch(element, /\binert\b/, "#greeter must not be inert");
  assert.doesNotMatch(element, /aria-hidden/, "#greeter must not be aria-hidden");
  assert.match(element, /role="dialog"/, "#greeter must be a dialog");
  assert.match(element, /aria-label="/, "#greeter needs an accessible name");
  assert.match(html, /class="greeter-login" data-login>/, "#greeter needs a focusable Log In button");
  assert.doesNotMatch(html, /data-login[^>]*tabindex="-1"/, "the Log In button must be focusable");
});

test("the session is stored so a returning visitor is not asked to log in again", async () => {
  const html = await read("index.html");
  const session = await read("assets", "js", "wm", "session.js");
  assert.match(html, /j3w1\.wm\.session/, "the inline script must read the stored session");
  assert.match(session, /export const startSession/, "session.js must be able to start a session");
  assert.match(session, /export const endSession/, "logging out must be possible");
  /* A shared link to an entry must never land on a login screen. */
  assert.match(html, /hash === "" \|\| hash === "home"/, "deep links must bypass the greeter");
});

test("the chrome has exactly one live region", async () => {
  const html = await read("index.html");
  const live = [...html.matchAll(/<[^>]*aria-live="polite"[^>]*>/g)].map((match) => match[0]);
  const chrome = live.filter((tag) => !/data-content-detail|project-detail-pane/.test(tag));
  assert.equal(chrome.length, 1, `expected one chrome live region, found ${chrome.length}`);
  assert.match(chrome[0], /id="workspace-announcer"/);
});

test("every declared window exists, is focusable, and has a tab title", async () => {
  const html = await read("index.html");
  const defaults = await read("assets", "js", "wm", "defaults.js");
  const declared = [...defaults.matchAll(/\["([a-z-]+)", [\d.]+\]/g)].map((match) => match[1]);
  assert.ok(declared.length >= 13, "expected the full window inventory");

  const authored = [...html.matchAll(/data-wm-window="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...authored].sort(), [...declared].sort(), "markup and defaults disagree");
  assert.equal(new Set(authored).size, authored.length, "duplicate data-wm-window id");

  for (const id of declared) {
    const element = html.match(new RegExp(`<article[^>]*data-wm-window="${id}"[^>]*>`))?.[0];
    assert.match(element, /tabindex="0"/, `${id} must be reachable with Tab alone`);
    assert.match(element, /data-wm-title="/, `${id} needs a tab title`);
    assert.match(element, /aria-label="/, `${id} needs an accessible name`);
  }
});

test("every workspace has a layer, a decoration surface, and an empty state", async () => {
  const html = await read("index.html");
  const names = ["home", "writing", "projects", "photography", "books", "elsewhere", "about"];
  for (const name of names) {
    assert.match(html, new RegExp(`data-wm-layer="${name}"`), `${name} has no layer`);
  }
  assert.equal((html.match(/data-wm-deco/g) ?? []).length, names.length);
  assert.equal((html.match(/data-wm-empty/g) ?? []).length, names.length);
  /* Getting windows back must not require knowing a keybinding. */
  assert.equal((html.match(/data-wm-restore/g) ?? []).length, names.length);
});

test("content hooks stay unique so the renderer cannot target two windows", async () => {
  const html = await read("index.html");
  for (const collection of ["writing", "books", "photography"]) {
    for (const hook of ["data-content-list", "data-content-detail"]) {
      const count = (html.match(new RegExp(`${hook}="${collection}"`, "g")) ?? []).length;
      assert.equal(count, 1, `${hook}="${collection}" appears ${count} times; expected 1`);
    }
  }
});

test("the pre-paint decision script and session.js agree on storage keys", async () => {
  const html = await read("index.html");
  const session = await read("assets", "js", "wm", "session.js");
  for (const key of ["j3w1.wm.boot", "j3w1.wm.session"]) {
    assert.ok(html.includes(`"${key}"`), `index.html is missing ${key}`);
    assert.ok(session.includes(`"${key}"`), `session.js is missing ${key}`);
  }
  /* The greeter decision has to happen before first paint, which means it lives
     in an inline script rather than in the module. */
  assert.match(html, /navigator\.webdriver/, "automation must skip the greeter");

  /* Reduced motion no longer suppresses the greeter outright — logging in is a
     real step now — so it skips straight to the login panel with no animation. */
  const greeter = await read("assets", "js", "wm", "greeter.js");
  assert.match(greeter, /reducedMotion/, "the greeter must honour reduced motion");
  assert.match(greeter, /instant: Boolean\(reducedMotion\)/, "reduced motion must skip the boot animation, not the login");
});

test("the fallback path covers no-JS and a failed boot", async () => {
  const css = await read("assets", "css", "desktop.css");
  assert.match(css, /html:not\(\.wm-active\)/, "missing the unified fallback selector");
  assert.match(css, /html\[data-wm="off"\] body/, "a failed boot must restore document scrolling");

  /* Plain mode was removed: it is not an i3 feature. The stacked layout survives
     only as the no-JS and boot-failure fallback, never as a mode anyone selects. */
  const html = await read("index.html");
  const siteScript = await read("assets", "js", "site.js");
  assert.doesNotMatch(html, /wm-toggle/, "the plain-mode toggle must be gone");
  assert.doesNotMatch(html, /\?plain|has\("plain"\)/, "the plain query parameter must be gone");
  assert.doesNotMatch(siteScript, /setEnabled/, "the enable/disable switch must be gone");
  assert.match(html, /id="power-menu"/, "the session menu replaces it");

  /* The old ad-hoc mobile tabs are gone; nothing may hide a window by that name. */
  const siteCss = await read("assets", "css", "site.css");
  assert.doesNotMatch(siteCss, /is-mobile-active/, "stale mobile pane rules remain");
  assert.doesNotMatch(siteCss, /mobile-buffer-tabs/, "stale buffer tab rules remain");
});

test("the wiki exists and the site points at it in more than one place", async () => {
  const wiki = await read("wiki", "index.html");
  const html = await read("index.html");
  const shell = await read("assets", "js", "wm", "apps", "shell.js");
  const boot = await read("assets", "js", "wm", "boot.js");

  assert.match(wiki, /<title>[^<]*[Ww]iki|<title>[^<]*guide/, "the wiki needs a descriptive title");
  assert.match(wiki, /rel="canonical" href="https:\/\/j3w1\.github\.io\/wiki\/"/, "the wiki needs a canonical URL");
  assert.match(wiki, /href="\/#home"/, "the wiki must link back to the workstation");

  /* Every hotkey the guide documents has to be a binding that really exists. */
  const bindings = await read("assets", "js", "wm", "keys.js");
  for (const key of ["Shift + R", "Shift + E", "Shift + C", "Shift + G", "Shift + S", "Alt + Shift + Space", "resize mode", "system mode", "gaps mode", "Ctrl + ← / →"]) {
    assert.ok(bindings.includes(key), `keys.js no longer defines ${key}`);
  }
  const guide = wiki.toLowerCase();
  for (const topic of ["shift</kbd>+<kbd>r", "shift</kbd>+<kbd>e", "shift</kbd>+<kbd>c", "shift</kbd>+<kbd>g", "resize mode", "gaps mode", "system mode", "scratchpad", "logout", "wallpaper", "back and forth", "hide the bar", "border none"]) {
    assert.ok(guide.includes(topic), `the wiki should document ${topic}`);
  }
  /* i3's own prompt for the system mode, verbatim from the original config. */
  assert.ok(bindings.includes("(l)ock, (e)xit, switch_(u)ser, (s)uspend, (h)ibernate, (r)eboot, (Shift+s)hutdown"));

  /* Discoverable from the desktop, not only from a URL someone was told about.
     The wiki and j3w1ctl live in the file manager's sidebar rather than the
     status tray: they are places you go, not readings the bar reports. */
  const sidebar = html.match(/<aside class="places-sidebar" aria-label="Places">[\s\S]*?<\/aside>/)?.[0] ?? "";
  const tray = html.match(/<div class="system-status"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(sidebar, /id="wiki-link"[^>]*href="\/wiki\/"/, "the Places sidebar needs the wiki link");
  assert.match(sidebar, /id="j3w1ctl-launch"/, "the Network section needs j3w1ctl");
  assert.doesNotMatch(tray, /wiki-link|j3w1ctl-launch/, "neither belongs in the status tray");
  assert.match(html, /help-intro-title[^<]*<a href="\/wiki\/"|<a href="\/wiki\/">full guide/, "the help dialog should link the wiki");
  assert.ok(shell.includes('"wiki"') || shell.includes("wiki:"), "the shell needs a wiki command");
  const commands = await read("assets", "js", "wm", "commands.js");
  assert.match(commands, /open wiki/, "the launcher needs a wiki command");
  /* Both now sit inside a window that can be closed, so the launcher has to be
     able to reach them regardless. */
  assert.match(commands, /exec j3w1ctl/, "the launcher needs a j3w1ctl command");

  const sitemap = await read("sitemap.xml");
  assert.match(sitemap, /https:\/\/j3w1\.github\.io\/wiki\//, "the wiki must be in the sitemap");
});

test("the desktop defaults to a black wallpaper carrying the j3w1-i3 wordmark", async () => {
  const defaults = await read("assets", "js", "wm", "defaults.js");
  const css = await read("assets", "css", "desktop.css");
  const boot = await read("assets", "js", "wm", "boot.js");

  assert.match(defaults, /WALLPAPERS = Object\.freeze\(\["black"/, "black must be the first, default wallpaper");
  assert.match(defaults, /wallpaper: WALLPAPERS\[0\]/, "the default state must use it");
  assert.match(css, /\.wallpaper \{[^}]*background: var\(--desktop\)/, "the base wallpaper must be plain black");
  assert.match(css, /content: "j3w1-i3"/, "the wordmark must be drawn on the wallpaper");
  assert.doesNotMatch(css, /data-wallpaper="carbon"/, "the retired wallpaper must be gone");

  /* A name persisted before the list changed must not survive the rename. */
  assert.match(boot, /WALLPAPERS\.includes\(state\.wallpaper\)/, "a stale wallpaper must be sanitised at boot");
});

test("the window manager stays small enough to keep the site dependency-free", async () => {
  /* Caps sit just above today's sizes: they are a ratchet against drift, not a
     target. Raise one deliberately when a feature justifies it. */
  const budget = [
    ["assets/css/desktop.css", 30_000],
    /* boot.js is over its intended size and is split in the realism phase
       (commands.js, chrome.js, console.js); this cap is the interim ceiling. */
    ["assets/js/wm/boot.js", 40_000],
    ["assets/js/wm/tree.js", 24_000],
    ["assets/js/wm/layout.js", 10_000],
    ["assets/js/wm/render.js", 11_000],
  ];
  for (const [file, cap] of budget) {
    const { size } = await fs.stat(path.join(repoRoot, file));
    assert.ok(size <= cap, `${file} is ${size} bytes, over its ${cap} byte budget`);
  }
  const dir = path.join(repoRoot, "assets", "js", "wm");
  const walk = async (target) => {
    let total = 0;
    for (const entry of await fs.readdir(target, { withFileTypes: true })) {
      const next = path.join(target, entry.name);
      total += entry.isDirectory() ? await walk(next) : (await fs.stat(next)).size;
    }
    return total;
  };
  const total = await walk(dir);
  assert.ok(total <= 216_000, `assets/js/wm is ${total} bytes, over its 216000 byte budget`);

  /* The ratchet that matters for first paint is the eager graph — modules a
     static import chain reaches from boot.js. Lazy curtains, apps and the
     power sequences do not compete with it. */
  const eager = new Set();
  const queue = [path.join(dir, "boot.js")];
  while (queue.length) {
    const file = queue.shift();
    if (eager.has(file)) continue;
    eager.add(file);
    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(/^import[^;]*?from "([^"?]+)/gm)) {
      queue.push(path.resolve(path.dirname(file), match[1]));
    }
  }
  let eagerBytes = 0;
  for (const file of eager) eagerBytes += (await fs.stat(file)).size;
  /* Raised with the keymap's five binding modes, i3-gaps and the bar modes;
     the ratchet is against drift, not a target. */
  assert.ok(eagerBytes <= 168_000, `the eager window manager graph is ${eagerBytes} bytes, over its 168000 byte budget`);
});

test("the cache token is bumped whenever a versioned asset changes", async () => {
  /* Cache busting is manual here, and forgetting it ships new HTML against old
     CSS to every returning visitor — a failure that never shows up in tests,
     because each test run starts from an empty browser cache. */
  const html = await read("index.html");
  const token = html.match(/site\.css\?v=(\d{8}[a-z]?)/)?.[1];
  assert.ok(token, "index.html must version site.css with a dated token");

  const versioned = ["assets/css", "assets/js", "index.html", "wiki/index.html"];
  const git = (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  const dirty = git(["status", "--porcelain", "--", ...versioned]).length > 0;

  if (dirty) {
    const now = new Date();
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    assert.ok(
      token >= today,
      `versioned assets have uncommitted changes, so the ?v= token must be ${today} or later (it is ${token})`,
    );
    return;
  }

  const lastChanged = git(["log", "-1", "--format=%cd", "--date=format:%Y%m%d", "--", ...versioned]);
  assert.ok(
    !lastChanged || token >= lastChanged,
    `versioned assets last changed on ${lastChanged} but the ?v= token is still ${token}`,
  );
});

test("every shared-token asset, including dynamic imports and index.html, uses one cache-busting token", async () => {
  /* scripts/lib/cache-tokens.mjs is the single definition of which assets share
     the token; the bump script rewrites exactly the set this test checks. */
  const { shared } = await collectTokens(repoRoot);
  assert.equal(shared.size, 1, `shared assets use mixed cache tokens: ${[...shared.keys()].join(", ")}`);
  const uses = [...shared.values()].flat();
  assert.ok(uses.some((use) => use.startsWith("index.html → /assets/js/wm/boot.js")), "index.html must preload boot.js with the shared token");
  assert.ok(uses.some((use) => use.startsWith("assets/js/site.js → ./wm/boot.js")), "site.js must import boot.js with the shared token");
  assert.ok(uses.some((use) => use.startsWith("assets/js/wm/boot.js → ./greeter.js")), "dynamic imports must carry the shared token too");
});

test("the root package is development tooling only: the site has no runtime dependencies", async () => {
  const manifest = JSON.parse(await read("package.json"));
  assert.equal(manifest.dependencies, undefined, "the public site must not acquire npm runtime dependencies");
  assert.ok(manifest.devDependencies, "development tooling lives in devDependencies");
});

test("a boot failure always reaches the stacked fallback", async () => {
  /* html.js hides six workspaces and locks scrolling on the assumption that the
     desktop will take over. Three things can break that assumption — createWm
     throwing, a module in the static graph failing to load, or a boot that
     never completes — and each needs its own guard, because the one in site.js
     never runs when site.js itself fails to load. */
  const site = await read("assets", "js", "site.js");
  assert.match(site, /try \{\s*wm = createWm\(/, "site.js must wrap createWm in try/catch");
  const html = await read("index.html");
  assert.match(html, /window\.addEventListener\("error", fail, true\)/, "the inline script must catch module load failures");
  assert.match(html, /window\.setTimeout\(fail, \d{4,5}\)/, "the inline script must arm a boot deadline");
  assert.match(await read("404.html"), /<html[^>]*class="no-js"/, "404.html must opt into the scrolling fallback rules");
});

test("nothing in the window manager still refers to removed features", async () => {
  const html = await read("index.html");
  assert.doesNotMatch(html, /i3 \/ plain/, "the help dialog must not point at the removed plain-mode button");
  const dir = path.join(repoRoot, "assets", "js", "wm");
  const walk = async (target) => {
    let sources = "";
    for (const entry of await fs.readdir(target, { withFileTypes: true })) {
      const next = path.join(target, entry.name);
      sources += entry.isDirectory() ? await walk(next) : await fs.readFile(next, "utf8");
    }
    return sources;
  };
  const sources = await walk(dir);
  assert.doesNotMatch(sources, /modPreference/, "modPreference had no setter and bricked the keys when hand-edited");
});

test("keyboard focus on a pane is visible, and recycled tab buttons never keep a stale id", async () => {
  const css = await read("assets", "css", "site.css");
  assert.doesNotMatch(css, /\.pane:focus \{/, "an unconditional outline: 0 on .pane cancelled the focus ring");
  assert.match(css, /\.pane:focus-visible \{/);
  const render = await read("assets", "js", "wm", "render.js");
  assert.doesNotMatch(render, /if \(!button\.id\)/);
});

test("global window manager handlers are registered through listen() so destroy() can remove them", async () => {
  const boot = await read("assets", "js", "wm", "boot.js");
  assert.doesNotMatch(boot, /\n  document\.addEventListener\(/, "boot.js must register document handlers through listen()");
  assert.doesNotMatch(boot, /\n  window\.addEventListener\(/, "boot.js must register window handlers through listen()");
  assert.match(boot, /try \{\s*instance = await spec\.create\(/, "spawn needs an error boundary");
  const greeter = await read("assets", "js", "wm", "greeter.js");
  assert.doesNotMatch(greeter.replace(/const later = [\s\S]*?\n  \};/, ""), /\bsetTimeout\(/, "greeter timers must be tracked through later()");
});

test("the self-hosted font is the generated WOFF2 subset, never a whole TTF", async () => {
  const dir = path.join(repoRoot, "assets", "fonts");
  const entries = await fs.readdir(dir);
  assert.ok(!entries.some((name) => /\.(ttf|otf)$/i.test(name)), "no whole font files under assets/fonts");
  let total = 0;
  for (const name of entries.filter((entry) => entry.endsWith(".woff2"))) {
    total += (await fs.stat(path.join(dir, name))).size;
  }
  assert.ok(total > 0 && total <= 64_000, `font faces total ${total} bytes, over the 64000 byte budget`);
  const css = await read("assets", "css", "site.css");
  assert.match(css, /\/\* @generated-fonts:start \*\/[\s\S]*sauce-code-pro-text\.woff2\?v=[0-9a-f]{8}[\s\S]*\/\* @generated-fonts:end \*\//);
  assert.match(css, /size-adjust:/, "fallback faces must be metric-matched");
  assert.doesNotMatch(css, /JetBrains/);
  const html = await read("index.html");
  const token = css.match(/sauce-code-pro-text\.woff2\?v=([0-9a-f]{8})/)[1];
  assert.ok(html.includes(`<link rel="preload" href="/assets/fonts/sauce-code-pro-text.woff2?v=${token}" as="font" type="font/woff2" crossorigin>`), "index.html must preload the text face with its content hash");
});

test("index.html preloads exactly the static module graph, and the applications are lazy", async () => {
  const { collectStaticGraph } = await import("../scripts/lib/preloads.mjs");
  const graph = await collectStaticGraph(repoRoot);
  const html = await read("index.html");
  const preloaded = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((match) => match[1]).sort();
  assert.deepEqual(preloaded, graph, "run npm run generate to refresh the modulepreload list");
  assert.ok(graph.some((href) => href.startsWith("/assets/js/wm/tree.js")), "the wm modules are in the graph");
  for (const app of ["neofetch", "htop", "cmatrix", "feh"]) {
    assert.ok(!graph.some((href) => href.includes(`/apps/${app}.js`)), `${app} must be loaded on first launch, not at boot`);
  }
  const admin = await read("admin", "j3w1ctl.js");
  assert.doesNotMatch(admin, /^import .* from "\/admin\/j3w1ctl-blob-client\.js/m, "the blob client is fetched on first upload only");
});

test("the site is discoverable: social tags, feed, icons, manifest, robots, and no redirect stubs", async () => {
  const html = await read("index.html");
  for (const tag of ['property="og:image"', 'property="og:site_name"', 'name="twitter:card"', 'rel="alternate" type="application/atom+xml"', 'rel="manifest"', 'rel="apple-touch-icon"', 'href="/favicon.ico"']) {
    assert.ok(html.includes(tag), `index.html must carry ${tag}`);
  }
  assert.match(html, /<span lang="zh">申杰<\/span>/, "the Chinese name is marked with its language");
  assert.match(html, /"@type": "WebSite"/);
  const robots = await read("robots.txt");
  assert.match(robots, /Disallow: \/admin\//);
  assert.match(robots, /Sitemap: https:\/\/j3w1\.github\.io\/sitemap\.xml/);
  for (const gone of ["about/index.html", "projects/index.html", "themes"]) {
    await assert.rejects(fs.access(path.join(repoRoot, gone)), `${gone} must not exist: the 404 rescue covers it`);
  }
  const notFound = await read("404.html");
  assert.match(notFound, /location\.replace\(/, "404.html must forward path-shaped links into the desktop's routes");
  const manifest = JSON.parse(await read("site.webmanifest"));
  assert.equal(manifest.start_url, "/#home");
  for (const icon of manifest.icons) {
    await fs.access(path.join(repoRoot, icon.src.replace(/^\//, "")));
  }
});

const pngSize = (buffer) => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

test("the raster icons and the social card exist at the sizes their consumers expect", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  for (const [file, width, height] of [["apple-touch-icon.png", 180, 180], ["assets/icons/icon-192.png", 192, 192], ["assets/icons/icon-512.png", 512, 512], ["assets/social/default.png", 1200, 630]]) {
    const buffer = await fs.readFile(path.join(repoRoot, file));
    assert.ok(buffer.subarray(0, 4).equals(png), `${file} must be a PNG`);
    assert.deepEqual(pngSize(buffer), { width, height }, `${file} must be ${width}×${height}`);
  }
  const ico = await fs.readFile(path.join(repoRoot, "favicon.ico"));
  assert.equal(ico.readUInt16LE(2), 1, "favicon.ico must be an icon resource");
  assert.ok(ico.subarray(22, 26).equals(png), "favicon.ico wraps a PNG");
});

test("the generated pages, sitemap and feed are committed and current", async () => {
  const { checkGenerated } = await import("../services/j3w1ctl-auth/src/generate.js");
  const result = await checkGenerated(repoRoot);
  assert.deepEqual({ stale: result.stale, orphans: result.orphans }, { stale: [], orphans: [] }, "run npm run generate");
  const sitemap = await read("sitemap.xml");
  assert.match(sitemap, /<loc>https:\/\/j3w1\.github\.io\/photography\/we-were-werewolves\/<\/loc>/, "every entry has a crawlable URL");
  const page = await read("photography", "we-were-werewolves", "index.html");
  assert.match(page, /<link rel="canonical" href="https:\/\/j3w1\.github\.io\/photography\/we-were-werewolves\/">/);
  assert.match(page, /data-desktop-link href="\/#photography\/we-were-werewolves"/);
});
