/* Mechanical enforcement of the window manager's accessibility and structure
   contract. These are the rules that are cheap to break silently and expensive
   to notice: see docs/wm-accessibility.md for the reasoning behind each one. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
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
  assert.match(greeter, /if \(reducedMotion\) \{?\s*skipBoot\(\)/, "reduced motion must skip the boot animation");
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

test("the window manager stays small enough to keep the site dependency-free", async () => {
  /* Caps sit just above today's sizes: they are a ratchet against drift, not a
     target. Raise one deliberately when a feature justifies it. */
  const budget = [
    ["assets/css/desktop.css", 24_000],
    ["assets/js/wm/boot.js", 36_000],
    ["assets/js/wm/tree.js", 20_000],
    ["assets/js/wm/layout.js", 8_000],
    ["assets/js/wm/render.js", 10_000],
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
  assert.ok(total <= 160_000, `assets/js/wm is ${total} bytes, over its 160000 byte budget`);
});

test("the whole wm directory shares one cache-busting token", async () => {
  const dir = path.join(repoRoot, "assets", "js", "wm");
  const tokens = new Set();
  const walk = async (target) => {
    for (const entry of await fs.readdir(target, { withFileTypes: true })) {
      const next = path.join(target, entry.name);
      if (entry.isDirectory()) {
        await walk(next);
        continue;
      }
      const source = await fs.readFile(next, "utf8");
      for (const match of source.matchAll(/from "([^"]+)\?v=([^"]+)"/g)) {
        /* Modules outside the wm tree are versioned independently: they are only
           re-published when they actually change. */
        if (!/\/wm\/|^\.\/[a-z-]+\.js$|^\.\.\/[a-z-]+\.js$/.test(match[1])) continue;
        if (match[1].includes("content-renderer")) continue;
        tokens.add(match[2]);
      }
    }
  };
  await walk(dir);
  assert.equal(tokens.size, 1, `wm modules use mixed cache tokens: ${[...tokens].join(", ")}`);
});
