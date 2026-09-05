import { expect, test } from "@playwright/test";
import { startBrowserFixture } from "../browser-fixture-server.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await startBrowserFixture();
});

test.afterAll(async () => {
  await fixture.close();
});

const open = async (page, path = "/#home") => {
  await page.goto(`${fixture.frontendOrigin}${path}`);
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
};

/* i3-gaps: the inner gap between tiles and the edge inset (inner + outer),
   read from the stylesheet's tokens so the tests follow the config. */
const gaps = (page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const inner = Number.parseFloat(style.getPropertyValue("--gaps-inner"));
    const outer = Number.parseFloat(style.getPropertyValue("--gaps-outer"));
    return { inner, edge: Math.max(0, inner + outer) };
  });

const rect = (page, id) =>
  page.evaluate((windowId) => {
    const node = document.querySelector(`[data-wm-window="${windowId}"]`);
    if (!node || node.hidden) return null;
    return {
      x: Math.round(node.offsetLeft),
      y: Math.round(node.offsetTop),
      w: Math.round(node.offsetWidth),
      h: Math.round(node.offsetHeight),
    };
  }, id);

test("the window manager boots and tiles the home workspace without seams", async ({ page }) => {
  await open(page);
  const terminal = await rect(page, "home-terminal");
  const files = await rect(page, "home-files");
  expect(terminal).not.toBeNull();
  expect(files).not.toBeNull();
  expect(terminal.y).toBe(files.y);
  /* The gap between tiles is exactly the inner gap; no overlap, no dead pixels. */
  const { inner, edge } = await gaps(page);
  expect(inner).toBe(14);
  expect(files.x - (terminal.x + terminal.w)).toBe(inner);
  const layer = await page.evaluate(() =>
    document.querySelector('[data-wm-layer="home"]').clientWidth);
  expect(files.x + files.w).toBe(layer - edge);
  expect(terminal.x).toBe(edge);
});

test("the self test passes in the browser", async ({ page }) => {
  const messages = [];
  page.on("console", (message) => messages.push(message.text()));
  await open(page, "/?wm=selftest#home");
  await page.waitForFunction(() =>
    performance.now() > 1500, null, { timeout: 10_000 });
  const summary = messages.find((text) => text.includes("[wm] selftest:"));
  expect(summary).toBeTruthy();
  expect(summary).not.toMatch(/ 0\//);
  expect(messages.filter((text) => text.startsWith("FAIL"))).toEqual([]);
});

test("digits switch workspaces and hjkl moves focus between tiles", async ({ page }) => {
  await open(page);
  await page.locator("body").press("2");
  await expect(page.locator("#writing")).toBeVisible();
  await expect(page.locator("#status-workspace")).toHaveText("/home/j3w1/writing");

  await page.locator("body").press("1");
  await expect(page.locator("#home")).toBeVisible();
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("l");
  await expect(page.locator('[data-wm-window="home-files"]')).toHaveClass(/is-focused/);
  await page.keyboard.press("h");
  await expect(page.locator('[data-wm-window="home-terminal"]')).toHaveClass(/is-focused/);
});

test("w tabs a workspace into a real tablist and e untiles it", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("w");
  const tablist = page.locator('[data-wm-layer="home"] .wm-tabbar');
  await expect(tablist).toHaveAttribute("role", "tablist");
  await expect(tablist.locator('[role="tab"]')).toHaveCount(2);
  await expect(page.locator('[data-wm-window="home-files"]')).toBeHidden();

  /* The hidden tab child must still be reachable: that is what the tablist is for. */
  await tablist.locator('[role="tab"]').nth(1).click();
  await expect(page.locator('[data-wm-window="home-files"]')).toBeVisible();
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeHidden();

  await page.locator('[data-wm-window="home-files"]').focus();
  await page.keyboard.press("e");
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
  await expect(page.locator('[data-wm-window="home-files"]')).toBeVisible();
});

test("f fullscreens, q closes, and Shift+R restores every window", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("f");
  const layer = await page.evaluate(() => {
    const node = document.querySelector('[data-wm-layer="home"]');
    return { w: node.clientWidth, h: node.clientHeight };
  });
  expect(await rect(page, "home-terminal")).toMatchObject({ x: 0, y: 0, w: layer.w, h: layer.h });
  await page.keyboard.press("Escape");

  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("q");
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeHidden();
  /* Focus must land on a live window, never on <body>. */
  expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe("BODY");

  await page.keyboard.press("Shift+R");
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
  await expect(page.locator('[data-wm-window="home-files"]')).toBeVisible();
});

test("closing every window offers a keyboard-reachable way back", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("q");
  await page.keyboard.press("q");
  const empty = page.locator('[data-wm-layer="home"] [data-wm-empty]');
  await expect(empty).toBeVisible();
  await empty.getByRole("button", { name: /restore/i }).click();
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
});

test("the dmenu launcher runs window manager commands", async ({ page }) => {
  await open(page);
  await page.locator("body").press("/");
  await page.locator("#command-input").fill("exec neofetch");
  await page.locator("#command-input").press("Enter");
  await expect(page.locator('[data-wm-window^="neofetch-"]')).toBeVisible();
  await expect(page.locator(".neofetch-info")).toContainText("Manjaro");
});

test("the terminal is a real shell over the site's content", async ({ page }) => {
  await open(page);
  const input = page.locator('[data-wm-window="home-terminal"] .shell-input');
  await input.click();
  await input.fill("ls");
  await input.press("Enter");
  /* The authored transcript already contains a list, so assert on the newest one. */
  await expect(page.locator('[data-wm-window="home-terminal"] .terminal-list').last())
    .toContainText("writing/");
  await input.fill("cd projects");
  await input.press("Enter");
  await input.fill("ls");
  await input.press("Enter");
  await expect(page.locator('[data-wm-window="home-terminal"]')).toContainText("j3w1zsh.md");
});

test("dragging the gutter resizes neighbouring tiles", async ({ page }) => {
  await open(page);
  const before = await rect(page, "home-terminal");
  const layer = await page.locator('[data-wm-layer="home"]').boundingBox();
  const seamX = layer.x + before.x + before.w + 1;
  const seamY = layer.y + before.h / 2;
  await page.mouse.move(seamX, seamY);
  await page.mouse.down();
  await page.mouse.move(seamX + 160, seamY, { steps: 12 });
  await page.mouse.up();
  const after = await rect(page, "home-terminal");
  expect(after.w).toBeGreaterThan(before.w + 100);
  const files = await rect(page, "home-files");
  expect(files.x - (after.x + after.w)).toBe((await gaps(page)).inner);
});

test("Alt+dragging a title bar floats a window and keeps it on screen", async ({ page }) => {
  await open(page);
  const box = await page.locator('[data-wm-window="home-terminal"] .window-titlebar').boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2 + 120, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.locator('[data-wm-window="home-terminal"]')).toHaveClass(/is-floating/);
  const floated = await rect(page, "home-terminal");
  expect(floated.x).toBeGreaterThan(0);
  expect(floated.y).toBeGreaterThan(0);
});

test("an ordinary click still selects a project row rather than starting a drag", async ({ page }) => {
  await open(page, "/#projects");
  await page.locator('[data-project-row="1688tocsv"] .project-selector').click();
  await expect(page.locator('[data-project-detail="1688tocsv"]')).toHaveClass(/is-selected/);
  await expect(page.locator("#project-status-selection")).toHaveText("1688toCSV");
});

/* The browser fixture serves its own content index, so the slug comes from there
   rather than from the published site. */
test("deep links resolve and never show the greeter", async ({ page }) => {
  await page.goto(`${fixture.frontendOrigin}/#photography/fixture-photographs`);
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  await expect(page.locator("#greeter")).toBeHidden();
  await expect(page.locator("#photography")).toBeVisible();
  await expect(page.locator('[data-content-detail="photography"] .photo-grid')).toBeVisible();
});

test("content hooks stay unique so the renderer targets the right windows", async ({ page }) => {
  await open(page);
  const counts = await page.evaluate(() =>
    ["writing", "books", "photography"].map((collection) => [
      document.querySelectorAll(`[data-content-list="${collection}"]`).length,
      document.querySelectorAll(`[data-content-detail="${collection}"]`).length,
    ]));
  expect(counts).toEqual([[1, 1], [1, 1], [1, 1]]);
});




test("there is no plain-mode toggle; the tray offers a session menu instead", async ({ page }) => {
  await open(page);
  expect(await page.locator("#wm-toggle").count()).toBe(0);

  const toggle = page.locator("#power-menu-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  const menu = page.locator("#power-menu");
  await expect(menu).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  for (const label of ["Lock screen", "Log out", "Restart i3 in place", "Cancel"]) {
    await expect(menu.getByRole("button", { name: label })).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  /* Shift+E opens it rather than logging out outright, as i3's nagbar does. */
  await page.locator("body").press("Shift+E");
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Cancel" }).click();
  await expect(menu).toBeHidden();
});

test("the session menu restarts the window manager in place", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("q");
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeHidden();
  await page.locator("#power-menu-toggle").click();
  await page.locator("#power-menu").getByRole("button", { name: "Restart i3 in place" }).click();
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
});

test("the wiki and j3w1ctl live in the file manager, not the status tray", async ({ page }) => {
  await open(page);
  const tray = page.locator(".system-status");
  expect(await tray.locator("#wiki-link").count()).toBe(0);
  expect(await tray.locator("#j3w1ctl-launch").count()).toBe(0);

  const sidebar = page.locator('[data-wm-window="home-files"] .places-sidebar');
  await expect(sidebar.locator("#wiki-link")).toBeVisible();
  await expect(sidebar.locator("#wiki-link")).toHaveAttribute("href", "/wiki/");
  await expect(sidebar.locator("#j3w1ctl-launch")).toBeVisible();

  /* It became a <button>, so the existing click handler must still fire. */
  await sidebar.locator("#j3w1ctl-launch").click();
  await expect(page.locator("#j3w1ctl-root")).not.toBeEmpty();
});

test("the three system readings survive at a common laptop width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const blocks = await page.evaluate(() =>
    [...document.querySelectorAll("#i3status .i3block")]
      .filter((node) => node.offsetParent)
      .map((node) => node.dataset.block));
  /* The whole point of moving the tray buttons out: these three fit again. */
  for (const block of ["net", "cpu", "mem"]) {
    expect(blocks, `${block} should be visible at 1440px`).toContain(block);
  }
});

test("the desktop is black by default and carries the j3w1-i3 wordmark", async ({ page }) => {
  await open(page);
  const desktop = await page.evaluate(() => {
    const wallpaper = document.querySelector("#wallpaper");
    const mark = getComputedStyle(wallpaper, "::after");
    return {
      name: document.documentElement.dataset.wallpaper,
      background: getComputedStyle(wallpaper).backgroundImage,
      content: mark.content,
      weight: mark.fontWeight,
    };
  });
  expect(desktop.name).toBe("black");
  expect(desktop.background).toBe("none");
  expect(desktop.content).toContain("j3w1-i3");
  expect(Number(desktop.weight)).toBeGreaterThanOrEqual(700);

  /* Declaring the wordmark is not enough: the wallpaper paints below block
     backgrounds, so an opaque body would hide it entirely. */
  const bodyBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(bodyBackground);
});

test("the wordmark survives raised contrast and forced colours", async ({ browser }) => {
  /* It was hidden outright under prefers-contrast, and painted in the canvas
     ink under forced colours — invisible in both, which is how it reached a
     real desktop looking like it had never shipped. */
  for (const [label, options] of [
    ["prefers-contrast: more", { contrast: "more" }],
    ["forced-colors: active", { forcedColors: "active" }],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
    const page = await context.newPage();
    await page.goto(`${fixture.frontendOrigin}/#home`);
    await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
    const mark = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector("#wallpaper"), "::after");
      return { content: style.content, opacity: Number(style.opacity) };
    });
    expect(mark.content, label).toContain("j3w1-i3");
    expect(mark.opacity, `${label} must not hide the wordmark`).toBeGreaterThan(0.2);
    await context.close();
  }
});

test("a wallpaper stored before the list changed is reset rather than left dangling", async ({ page }) => {
  await open(page);
  /* Nothing is persisted until the layout actually changes, and the write is
     debounced, so make a change and let it land before tampering with it. */
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("w");
  await page.waitForFunction(() => localStorage.getItem("j3w1.wm.layout") !== null);
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("j3w1.wm.layout"));
    saved.wallpaper = "carbon";
    localStorage.setItem("j3w1.wm.layout", JSON.stringify(saved));
  });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  expect(await page.evaluate(() => document.documentElement.dataset.wallpaper)).toBe("black");
});

test("feh switches wallpapers and remembers the choice", async ({ page }) => {
  await open(page);
  await page.locator("body").press("/");
  await page.locator("#command-input").fill("exec feh");
  await page.locator("#command-input").press("Enter");
  await expect(page.locator(".feh-grid")).toBeVisible();
  await page.locator('[data-wallpaper="ember"]').click();
  expect(await page.evaluate(() => document.documentElement.dataset.wallpaper)).toBe("ember");
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  expect(await page.evaluate(() => document.documentElement.dataset.wallpaper)).toBe("ember");
});

test("the status blocks share one background and sit behind a single divider", async ({ page }) => {
  await open(page);
  const style = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll("#i3status .i3block")].filter((n) => n.offsetParent);
    const first = getComputedStyle(blocks[0]);
    return {
      count: blocks.length,
      backgrounds: new Set(blocks.map((n) => getComputedStyle(n).backgroundColor)).size,
      barBackground: getComputedStyle(document.querySelector(".wm-bar")).backgroundColor,
      blockBackground: first.backgroundColor,
      dividers: blocks.filter((n) => getComputedStyle(n).borderLeftWidth !== "0px").length,
    };
  });
  expect(style.count).toBeGreaterThan(0);
  expect(style.backgrounds).toBe(1);
  expect(style.blockBackground).toBe(style.barBackground);
  /* Every visible block carries a divider, so the boundary with the workspace
     names never lands on a block the viewport has hidden. */
  expect(style.dividers).toBe(style.count);
});

test("the status bar shows no fabricated values", async ({ page }) => {
  await open(page);
  const blocks = await page.evaluate(() =>
    [...document.querySelectorAll("#i3status .i3block")]
      .filter((node) => node.offsetParent)
      .map((node) => node.querySelector(".i3block-value").textContent.trim()));

  /* A block whose source the browser does not expose is absent, never a
     placeholder — so every block that is rendered must carry a real value. */
  expect(blocks.length).toBeGreaterThan(0);
  for (const value of blocks) {
    expect(value).not.toEqual("");
    expect(value).not.toMatch(/\bn\/a\b|\bunknown\b|^-+$/i);
  }
});

test("the status bar never squeezes the workspace names, at any width", async ({ page }) => {
  await open(page);
  for (const width of [1920, 1600, 1500, 1440, 1366, 1280, 1100, 900]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForFunction(() => true);
    const fit = await page.evaluate(() => {
      const status = document.querySelector("#i3status");
      const tray = document.querySelector(".system-status");
      return {
        status: status.scrollWidth <= status.clientWidth + 1,
        tray: tray.scrollWidth <= tray.clientWidth + 1,
      };
    });
    expect(fit, `status blocks overflow at ${width}px`).toEqual({ status: true, tray: true });
  }
});

test("layout survives a reload and killed windows always come back", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("w");
  await expect(page.locator('[data-wm-layer="home"] .wm-tabbar')).toBeVisible();
  await page.keyboard.press("q");
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  await expect(page.locator('[data-wm-layer="home"] .wm-tabbar')).toBeVisible();
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
});

/* The suite normally runs with navigator.webdriver true, which keeps automation
   off the greeter entirely. These tests opt back in to exercise the login. */
const openWithGreeter = async (page, path = "/#home") => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "webdriver", { get: () => false }));
  await page.goto(`${fixture.frontendOrigin}${path}`);
};

test("the boot sequence runs, then the login waits for the visitor", async ({ page }) => {
  await openWithGreeter(page);
  await expect(page.locator("#greeter")).toBeVisible();
  await expect(page.locator("[data-boot-screen]")).toBeVisible();
  await expect(page.locator("[data-log] li").first()).toBeVisible();

  await page.keyboard.press("x");
  const panel = page.locator("[data-login-screen]");
  await expect(panel).toBeVisible();
  await expect(page.locator(".greeter-user")).toHaveText("j3w1");

  /* It must not log itself in: still waiting several seconds later. */
  await page.waitForTimeout(2500);
  await expect(panel).toBeVisible();

  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page.locator("#greeter")).toBeHidden();
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
});

test("only Enter or the Log In button logs in", async ({ page }) => {
  await openWithGreeter(page);
  await page.keyboard.press("x");
  const panel = page.locator("[data-login-screen]");
  await expect(panel).toBeVisible();

  /* A stray click on the screen behind the panel must not log anyone in. */
  await page.mouse.click(40, 400);
  await page.waitForTimeout(400);
  await expect(panel).toBeVisible();

  /* Nor does any other key. */
  await page.keyboard.press("a");
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  await expect(panel).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(page.locator("#greeter")).toBeHidden();
});

test("the lock screen yields to a keystroke, never to the mouse", async ({ page }) => {
  await open(page);
  await page.locator("body").press("/");
  await page.locator("#command-input").fill("exec i3lock");
  await page.locator("#command-input").press("Enter");
  const lock = page.locator("#lockscreen");
  await expect(lock).toBeVisible();

  /* Moving and clicking must leave it up: a passing mouse is not someone
     returning to the machine. */
  await page.mouse.move(300, 300);
  await page.mouse.move(700, 500);
  await page.mouse.click(700, 500);
  await page.waitForTimeout(600);
  await expect(lock).toBeVisible();

  await page.keyboard.press("a");
  await expect(lock).toBeHidden();
});

test("the bar shows the absolute path of the active workspace", async ({ page }) => {
  await open(page);
  await expect(page.locator("#status-workspace")).toHaveText("/home/j3w1");
  await page.locator("body").press("4");
  await expect(page.locator("#status-workspace")).toHaveText("/home/j3w1/photography");
  /* The workspace name already lives in the strip; the chip is the path now. */
  expect(await page.locator("#status-path").count()).toBe(0);
});

test("the password field holds only decoration, never a value", async ({ page }) => {
  await openWithGreeter(page);
  await page.keyboard.press("x");
  await expect(page.locator("[data-login-screen]")).toBeVisible();
  const dots = await page.locator("[data-dots]").textContent();
  expect(dots.replace(/[•\s]/g, "")).toEqual("");
  expect(await page.locator("[data-login-screen] input").count()).toBe(0);
});

test("a stored session skips the greeter, and logging out brings it back", async ({ page }) => {
  await openWithGreeter(page);
  await page.keyboard.press("x");
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page.locator("#greeter")).toBeHidden();

  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  await expect(page.locator("#greeter")).toBeHidden();
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();

  await page.locator("body").press("Shift+E");
  await page.locator("#power-menu").getByRole("button", { name: "Log out" }).click();
  await expect(page.locator("#greeter")).toBeVisible();
  /* Logging out returns to the login panel, not through the boot log again. */
  await expect(page.locator("[data-login-screen]")).toBeVisible();
  await expect(page.locator("[data-boot-screen]")).toBeHidden();

  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page.locator("#greeter")).toBeHidden();
});

test("a deep link never lands on a login screen", async ({ page }) => {
  await openWithGreeter(page, "/#photography/fixture-photographs");
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  await expect(page.locator("#greeter")).toBeHidden();
  await expect(page.locator('[data-content-detail="photography"] .photo-grid')).toBeVisible();
});

test("dragging a fullscreen window carries a manageable proxy, not the whole screen", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("f");
  const full = await rect(page, "home-terminal");

  const bar = await page.locator('[data-wm-window="home-terminal"] .window-titlebar').boundingBox();
  await page.mouse.move(bar.x + 200, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + 260, bar.y + 180, { steps: 10 });
  const ghost = await page.evaluate(() => {
    const node = document.querySelector(".wm-drag-ghost");
    return node && !node.hidden ? { w: node.offsetWidth, h: node.offsetHeight } : null;
  });
  await page.mouse.up();

  expect(ghost).not.toBeNull();
  expect(ghost.w).toBeLessThan(full.w * 0.75);
  const dropped = await rect(page, "home-terminal");
  expect(dropped.w).toBeLessThan(full.w * 0.75);
  await expect(page.locator('[data-wm-window="home-terminal"]')).toHaveClass(/is-floating/);
});

test("dragging a title bar never leaves text selected", async ({ page }) => {
  await open(page);
  const bar = await page.locator('[data-wm-window="home-terminal"] .window-titlebar').boundingBox();
  await page.mouse.move(bar.x + 40, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + 240, bar.y + 160, { steps: 14 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected).toEqual("");
});

test("toasts stay clear of the focused window's controls", async ({ page }) => {
  await open(page);
  await page.locator("body").press("/");
  await page.locator("#command-input").fill("exec neofetch");
  await page.locator("#command-input").press("Enter");
  const toast = page.locator(".dunst-toast").first();
  await expect(toast).toBeVisible();
  const box = await toast.boundingBox();
  const controls = await page.locator(".window-mark-close").first().boundingBox();
  /* The window controls live at the top of a window; the toasts must not. */
  expect(box.y).toBeGreaterThan(controls.y + controls.height);
});

test("the terminal help separates commands from desktop keys", async ({ page }) => {
  await open(page);
  const input = page.locator('[data-wm-window="home-terminal"] .shell-input');
  await input.click();
  await input.fill("help");
  await input.press("Enter");
  const terminal = page.locator('[data-wm-window="home-terminal"]');
  await expect(terminal).toContainText("Commands you can type here");
  await expect(terminal).toContainText("Keys you press anywhere on the desktop");

  /* Typing a desktop shortcut into the shell should explain itself. */
  await input.fill("/dmenu");
  await input.press("Enter");
  await expect(terminal).toContainText("desktop shortcut, not a command");
});

test("mobile widths use a tabbed container with large touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${fixture.frontendOrigin}/#home`);
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  const tablist = page.locator('[data-wm-layer="home"] .wm-tabbar');
  await expect(tablist).toBeVisible();
  const tab = tablist.locator('[role="tab"]').first();
  const box = await tab.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(40);
});

test("a module that fails to load leaves the stacked, scrolling fallback", async ({ page }) => {
  await page.route("**/assets/js/wm/layout.js*", (route) => route.abort());
  await page.goto(`${fixture.frontendOrigin}/#home`);
  await page.waitForFunction(() => document.documentElement.dataset.wm === "off");
  await expect(page.locator("html")).not.toHaveClass(/wm-active/);
  await expect(page.locator("html")).not.toHaveAttribute("data-boot", /.+/);
  expect(await page.locator(".workspace:visible").count()).toBe(7);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe("hidden");
});

test("a throw inside boot leaves the stacked, scrolling fallback", async ({ page }) => {
  await page.addInitScript(() => {
    /* Only the window manager's own inventory query throws, so site.js
       evaluates normally and the try/catch around createWm is what is tested. */
    const original = document.querySelectorAll.bind(document);
    document.querySelectorAll = (selector) => {
      if (selector === "[data-wm-layer]") throw new Error("boom");
      return original(selector);
    };
  });
  await page.goto(`${fixture.frontendOrigin}/#home`);
  await page.waitForFunction(() => document.documentElement.dataset.wm === "off");
  await expect(page.locator("html")).not.toHaveClass(/wm-active/);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe("hidden");
});

test("arrow keys on the tab strip switch the visible panel and keep focus on the strip", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("w");
  const tabs = page.locator('[data-wm-layer="home"] .wm-tabbar [role="tab"]');
  await expect(tabs).toHaveCount(2);
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-wm-window="home-files"]')).toBeVisible();
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("tab");
  /* The visible panel is labelled by the tab that controls it, not a recycled id. */
  const labelledBy = await page.locator('[data-wm-window="home-files"]').getAttribute("aria-labelledby");
  await expect(tabs.nth(1)).toHaveAttribute("id", labelledBy);

  /* Enter on a focused tab activates it too, and moves focus into the window. */
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest("[data-wm-window]")?.dataset.wmWindow)).toBe("home-terminal");
});

test("tapping a tab does not freeze the workspace's responsive defaults", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  const tabs = page.locator('[data-wm-layer="home"] .wm-tabbar [role="tab"]');
  await expect(tabs.first()).toBeVisible();
  await tabs.nth(1).click();
  await expect(page.locator('[data-wm-window="home-files"]')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('[data-wm-layer="home"] .wm-tabbar')).toHaveCount(0);
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
  await expect(page.locator('[data-wm-window="home-files"]')).toBeVisible();
});

test("logging out and back in twice leaves one clean greeter each time", async ({ page }) => {
  await open(page);
  for (let i = 0; i < 2; i += 1) {
    await page.locator("body").press("/");
    await page.locator("#command-input").fill("log out");
    await page.locator("#command-input").press("Enter");
    await expect(page.locator("#greeter")).toBeVisible();
    await expect(page.locator("[data-login-screen]")).toBeVisible();
    await expect(page.locator("[data-boot-screen]")).toBeHidden();
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page.locator("#greeter")).toBeHidden();
    await expect(page.locator("html")).not.toHaveClass(/wm-greeting/);
    await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
  }
  /* One keydown capture listener: a second Escape/Enter is not swallowed by a
     stale greeter after two round trips. */
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("f");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-wm-window="home-files"]')).toBeVisible();
});

test("the first paint under the greeter flag is a curtain, not the desktop", async ({ page }) => {
  await openWithGreeter(page);
  await expect(page.locator("#greeter")).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body, "::before").position)).toBe("fixed");
  await page.keyboard.press("x");
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page.locator("#greeter")).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.body, "::before").position)).not.toBe("fixed");
});

test("a window moved to another workspace is visible there and comes back with Shift+R", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  /* Ctrl+Alt+2 moves the window and stays; Alt+Shift+2 would follow it. */
  await page.keyboard.press("Control+Alt+Digit2");
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeHidden();
  await expect(page).toHaveURL(/#home$/);
  await page.keyboard.press("2");
  await expect(page).toHaveURL(/#writing$/);
  const terminal = page.locator('[data-wm-window="home-terminal"]');
  await expect(terminal).toBeVisible();
  const moved = await rect(page, "home-terminal");
  const reader = await rect(page, "writing-reader");
  expect(moved.w).toBeGreaterThan(100);
  expect(moved.x).toBeGreaterThanOrEqual(reader.x + reader.w);
  /* It is a real window on this workspace: focusable, and its section's
     invisibility does not leak into it. */
  await terminal.locator(".shell-input").click();
  expect(await page.evaluate(() => document.activeElement?.closest("[data-wm-window]")?.dataset.wmWindow)).toBe("home-terminal");
  /* The workspace it left still renders correctly without it. */
  await terminal.focus();
  await page.keyboard.press("1");
  await expect(page).toHaveURL(/#home$/);
  await expect(terminal).toBeHidden();
  await expect(page.locator('[data-wm-window="home-files"]')).toBeVisible();
  await page.locator("body").press("Shift+R");
  await expect(terminal).toBeVisible();
});

test("an application that throws on launch leaves no orphan window behind", async ({ page }) => {
  await open(page);
  /* htop is the only application that builds a <tbody> while launching. */
  await page.evaluate(() => {
    const original = Document.prototype.createElement;
    Document.prototype.createElement = function createElement(tag, ...rest) {
      if (tag === "tbody") throw new Error("boom");
      return original.call(this, tag, ...rest);
    };
  });
  const before = await page.locator("[data-wm-window]:visible").count();
  await page.locator("body").press("/");
  await page.locator("#command-input").fill("exec htop");
  await page.locator("#command-input").press("Enter");
  await expect(page.locator("#dunst")).toContainText("exec htop failed");
  expect(await page.locator('[data-wm-window^="htop-"]').count()).toBe(0);
  expect(await page.locator("[data-wm-window]:visible").count()).toBe(before);
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
});

test("restarting in place three times leaves one click handler on the terminal", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP only");
  await open(page);
  for (let i = 0; i < 3; i += 1) {
    await page.locator('[data-wm-window="home-terminal"]').focus();
    await page.keyboard.press("Shift+R");
    await expect(page.locator("#dunst")).toContainText("restart");
  }
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: '[data-wm-window="home-terminal"] .terminal-buffer' });
  const { object } = await cdp.send("DOM.resolveNode", { nodeId });
  const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: object.objectId });
  expect(listeners.filter((entry) => entry.type === "click").length).toBe(1);
});

test("Escape in resize mode also leaves fullscreen in one press", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("f");
  await page.keyboard.press("r");
  await expect(page.locator("#wm-mode")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#wm-mode")).toBeHidden();
  await expect(page.locator('[data-wm-window="home-files"]')).toBeVisible();
});

test("title bar buttons do nothing while a curtain is up", async ({ page }) => {
  await openWithGreeter(page);
  await expect(page.locator("#greeter")).toBeVisible();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("j3w1.wm.layout") ?? "null"));
  await page.locator('[data-wm-action="close"]').first().dispatchEvent("click");
  await page.waitForTimeout(200);
  await expect(page.locator("#greeter")).toBeVisible();
  await page.keyboard.press("x");
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page.locator("#greeter")).toBeHidden();
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
  await expect(page.locator('[data-wm-window="home-files"]')).toBeVisible();
  void before;
});

test("the subset font loads, renders the bar's glyphs, and the swap moves nothing", async ({ page }) => {
  await page.addInitScript(() => {
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shifts.push(entry.value);
    }).observe({ type: "layout-shift", buffered: true });
  });
  await open(page);
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter((face) => face.status === "loaded").map((face) => `${face.family}/${face.weight}`));
  expect(loaded).toContain("SauceCodePro NFM/400");
  expect(loaded).toContain("SauceCodePro NFM/700");
  const requests = await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/assets/fonts/")).map((entry) => entry.name.split("/").pop()));
  expect(requests.some((name) => name.startsWith("sauce-code-pro-text.woff2"))).toBe(true);
  expect(requests.some((name) => name.endsWith(".ttf"))).toBe(false);
  const powerGlyph = await page.evaluate(() => document.fonts.check('12px "SauceCodePro NFM"', ""));
  expect(powerGlyph).toBe(true);
  const cls = await page.evaluate(() => window.__shifts.reduce((sum, value) => sum + value, 0));
  expect(cls).toBeLessThan(0.02);
});

test("the content index is requested once per page load, and a resize storm stays cheap", async ({ page }) => {
  await open(page);
  const input = page.locator('[data-wm-window="home-terminal"] .shell-input');
  await input.click();
  await input.fill("cd writing");
  await input.press("Enter");
  await input.fill("ls");
  await input.press("Enter");
  await expect(page.locator('[data-wm-window="home-terminal"]')).toContainText("fixture-essay");
  const requests = await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.includes("content-index.json")).length);
  expect(requests).toBe(1);

  await page.evaluate(() => {
    window.__long = 0;
    new PerformanceObserver((list) => { window.__long += list.getEntries().length; }).observe({ type: "longtask" });
  });
  for (let i = 0; i < 30; i += 1) {
    await page.setViewportSize({ width: 1000 + i * 12, height: 900 - (i % 3) * 20 });
  }
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__long)).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
});

test("photographs reserve their real box, load lazily, and are not cropped to 4:3", async ({ page }) => {
  await open(page, "/#photography/fixture-photographs");
  const thumbs = page.locator('[data-content-detail="photography"] .photo-thumb img');
  await expect(thumbs).toHaveCount(2);
  await expect(thumbs.nth(1)).toHaveAttribute("loading", "lazy");
  await expect(thumbs.nth(1)).toHaveAttribute("width", "512");
  await expect(thumbs.nth(1)).toHaveAttribute("height", "640");
  await expect(thumbs.nth(1)).toHaveAttribute("srcset", /512w.*1122w/);
  /* The fixture image is 1×1, so the rendered box follows the file; what must
     hold is that nothing forces a 4:3 crop on a portrait photograph. */
  const style = await thumbs.nth(1).evaluate((node) => ({ fit: getComputedStyle(node).objectFit, ratio: getComputedStyle(node).aspectRatio }));
  expect(style.fit).not.toBe("cover");
  expect(style.ratio).not.toMatch(/^4 \/ 3$/);
});

test("workspace back and forth, stepping, and the same digit twice", async ({ page }) => {
  await open(page);
  await page.locator("body").press("3");
  await expect(page).toHaveURL(/#projects$/);
  await page.locator("body").press("`");
  await expect(page).toHaveURL(/#home$/);
  await page.locator("body").press("`");
  await expect(page).toHaveURL(/#projects$/);
  /* workspace_auto_back_and_forth: 3 again goes back. */
  await page.locator("body").press("3");
  await expect(page).toHaveURL(/#home$/);
  await page.locator("body").press("Control+ArrowRight");
  await expect(page).toHaveURL(/#writing$/);
  await page.locator("body").press("Control+ArrowLeft");
  await expect(page).toHaveURL(/#home$/);
  await page.locator("body").press("Control+ArrowLeft");
  await expect(page).toHaveURL(/#home$/);
});

test("m hides the bar, and it comes back for keyboard focus and a binding mode", async ({ page }) => {
  await open(page);
  const bar = page.locator(".wm-bar");
  const shell = page.locator(".desktop-shell");
  const before = await shell.boundingBox();
  await page.locator("body").press("m");
  await expect(page.locator("html")).toHaveAttribute("data-bar", "hide");
  await expect(page.locator("#dunst")).toContainText("bar mode hide");
  const after = await shell.boundingBox();
  expect(after.height).toBeGreaterThan(before.height);
  /* Slid away, but still in the DOM and still reachable. */
  const transform = await bar.evaluate((node) => getComputedStyle(node).transform);
  expect(transform).not.toBe("none");
  await page.locator(".workspace-link").first().focus();
  await page.waitForTimeout(200);
  expect(await bar.evaluate((node) => getComputedStyle(node).transform)).toMatch(/matrix\(1, 0, 0, 1, 0, 0\)|none/);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("r");
  await expect(page.locator("html")).toHaveClass(/wm-mode-active/);
  await page.keyboard.press("Escape");
  await page.locator("body").press("m");
  await expect(page.locator("html")).toHaveAttribute("data-bar", "dock");
});

test("the system mode shows i3's prompt in the bar and Escape leaves it", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("0");
  await expect(page.locator("#wm-mode")).toHaveText("(l)ock, (e)xit, switch_(u)ser, (s)uspend, (h)ibernate, (r)eboot, (Shift+s)hutdown");
  await page.keyboard.press("Escape");
  await expect(page.locator("#wm-mode")).toBeHidden();
  await page.keyboard.press("0");
  await page.keyboard.press("l");
  await expect(page.locator("#lockscreen")).toBeVisible();
});

test("gaps mode widens the gap and reload re-applies it; border keys change the chrome", async ({ page }) => {
  await open(page);
  const before = await rect(page, "home-terminal");
  const base = (await gaps(page)).inner;
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("Shift+G");
  await expect(page.locator("#wm-mode")).toContainText("Gaps: (o) outer, (i) inner");
  await page.keyboard.press("i");
  await expect(page.locator("#wm-mode")).toContainText("Inner Gaps");
  await page.keyboard.press("+");
  await page.keyboard.press("Escape");
  const after = await rect(page, "home-terminal");
  const files = await rect(page, "home-files");
  expect(files.x - (after.x + after.w)).toBe(base + 5);
  expect((await gaps(page)).inner).toBe(base + 5, "the runtime override is written back to the stylesheet token");
  expect(after.w).toBeLessThan(before.w);
  await page.waitForTimeout(400);
  await page.keyboard.press("Shift+C");
  await expect(page.locator("#workspace-announcer")).toContainText("configuration reloaded");
  expect((await rect(page, "home-files")).x - (after.x + after.w)).toBe(base + 5);

  await page.waitForTimeout(400);
  await page.keyboard.press("y");
  await expect(page.locator('[data-wm-window="home-terminal"]')).toHaveClass(/wm-border-pixel/);
  await expect(page.locator('[data-wm-window="home-terminal"] .window-titlebar')).toBeHidden();
  await expect(page.locator("#dunst")).toContainText("Border set to pixel 1");
  await page.keyboard.press("n");
  await expect(page.locator('[data-wm-window="home-terminal"] .window-titlebar')).toBeVisible();
  /* The border survives a reload of the page. */
  await page.keyboard.press("u");
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  await expect(page.locator('[data-wm-window="home-terminal"]')).toHaveClass(/wm-border-none/);
});

/* The power sequences run under reduced motion so every state change is
   asserted in milliseconds; one un-reduced test checks the log really scrolls. */
const reduced = async (page) => page.emulateMedia({ reducedMotion: "reduce" });

test("reboot: spawned windows close, the session ends, the machine boots to the login, the layout survives", async ({ page }) => {
  await reduced(page);
  await open(page);
  await page.locator("body").press("/");
  await page.locator("#command-input").fill("exec neofetch");
  await page.locator("#command-input").press("Enter");
  await expect(page.locator('[data-wm-window^="neofetch-"]')).toBeVisible();
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("w");
  await expect(page.locator('[data-wm-layer="home"] .wm-tabbar')).toBeVisible();

  await page.keyboard.press("0");
  await page.keyboard.press("r");
  await expect(page.locator("#greeter")).toBeVisible();
  await expect(page.locator("[data-login-screen]")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("j3w1.wm.session"))).toBeNull();
  expect(await page.locator('[data-wm-window^="neofetch-"]').count()).toBe(0);
  /* Under reduced motion the boot log landed at once and the login panel is
     already up; the log still holds the whole boot. */
  expect(await page.locator("[data-log]").textContent()).toContain("Reached target Graphical Interface");

  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page.locator("#greeter")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("j3w1.wm.session"))).toBe("1");
  await expect(page.locator('[data-wm-layer="home"] .wm-tabbar')).toBeVisible();
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
});

test("shutdown halts to a power button; powering on boots to the login", async ({ page }) => {
  await reduced(page);
  await open(page);
  await page.keyboard.press("Shift+E");
  await page.getByRole("button", { name: "Shut down" }).click();
  await expect(page.locator("#greeter")).toHaveAttribute("data-phase", "off");
  const power = page.locator("[data-power-on]");
  await expect(power).toBeVisible();
  await expect(power).toBeFocused();
  /* A key powers the machine on — and reaches nothing underneath: the
     terminal is not killed by the q. */
  await page.keyboard.press("q");
  await expect(page.locator("[data-login-screen]")).toBeVisible();
  await expect(page.locator('[data-wm-window="home-terminal"]')).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator("#greeter")).toBeHidden();
  await expect(page.locator('[data-wm-window="home-terminal"]')).toBeVisible();
});

test("suspend sleeps over a locked session; the wake key does not unlock it", async ({ page }) => {
  await reduced(page);
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("0");
  await page.keyboard.press("s");
  await expect(page.locator("#greeter")).toHaveAttribute("data-phase", "sleep");
  await expect(page.locator("#lockscreen")).toBeVisible();
  await page.keyboard.press("x");
  await expect(page.locator("#greeter")).toBeHidden();
  await expect(page.locator("#lockscreen")).toBeVisible();
  await page.keyboard.press("x");
  await expect(page.locator("#lockscreen")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("j3w1.wm.session"))).toBe("1");
});

test("hibernate resumes through the kernel log to the lock screen", async ({ page }) => {
  await reduced(page);
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("0");
  await page.keyboard.press("h");
  await expect(page.locator("#greeter")).toHaveAttribute("data-phase", "sleep");
  await page.keyboard.press("x");
  await expect(page.locator("#greeter")).toBeHidden();
  await expect(page.locator("#lockscreen")).toBeVisible();
});

test("switch user shows the login panel and keeps the session and layout", async ({ page }) => {
  await reduced(page);
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("w");
  await page.keyboard.press("0");
  await page.keyboard.press("u");
  await expect(page.locator("[data-login-screen]")).toBeVisible();
  await expect(page.locator("[data-boot-screen]")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("j3w1.wm.session"))).toBe("1");
  await page.keyboard.press("Enter");
  await expect(page.locator("#greeter")).toBeHidden();
  await expect(page.locator('[data-wm-layer="home"] .wm-tabbar')).toBeVisible();
});

test("the shutdown log really scrolls, then the boot log follows, in order", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("0");
  await page.keyboard.press("r");
  await expect(page.locator("#greeter")).toHaveAttribute("data-phase", "shutdown");
  const early = await page.locator("[data-log] li").count();
  await page.waitForTimeout(500);
  const later = await page.locator("[data-log] li").count();
  expect(later).toBeGreaterThan(early);
  await expect(page.locator("[data-log]")).toContainText("reboot: Restarting system.", { timeout: 6000 });
  await expect(page.locator("#greeter")).toHaveAttribute("data-phase", "black", { timeout: 4000 });
  await expect(page.locator("[data-banner]")).toContainText("Manjaro Linux", { timeout: 4000 });
  await page.keyboard.press("x");
  await expect(page.locator("[data-login-screen]")).toBeVisible();
});

test("focus parent outlines the container and layout commands act on it", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("a");
  await expect(page.locator(".wm-confocus")).toBeVisible();
  await expect(page.locator("#workspace-announcer")).toContainText("container of 2 windows focused");
  const outline = await page.locator(".wm-confocus").boundingBox();
  const layer = await page.locator('[data-wm-layer="home"]').boundingBox();
  expect(outline.width).toBeGreaterThan(layer.width * 0.9);
  /* w on the container tabs the whole workspace; then a direction key returns focus to a window. */
  await page.keyboard.press("w");
  await expect(page.locator('[data-wm-layer="home"] .wm-tabbar')).toBeVisible();
  await page.keyboard.press("e");
  await page.keyboard.press("l");
  await expect(page.locator(".wm-confocus")).toHaveCount(0);
});

test("marks show in the title bar, [con_mark] focus finds them across workspaces, and swap trades places", async ({ page }) => {
  await open(page);
  const input = page.locator('[data-wm-window="home-terminal"] .shell-input');
  await input.click();
  await input.fill("i3-msg mark term");
  await input.press("Enter");
  await expect(page.locator('[data-wm-window="home-terminal"] .window-titlebar > :first-child')).toHaveAttribute("data-wm-marks", "term");
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("3");
  await expect(page).toHaveURL(/#projects$/);
  await page.locator("body").press("/");
  await page.locator("#command-input").fill("[con_mark=term] focus");
  await page.locator("#command-input").press("Enter");
  await expect(page).toHaveURL(/#home$/);
  expect(await page.evaluate(() => document.activeElement?.closest("[data-wm-window]")?.dataset.wmWindow)).toBe("home-terminal");

  const before = await rect(page, "home-terminal");
  await page.locator('[data-wm-window="home-files"]').focus();
  await input.click();
  await page.locator('[data-wm-window="home-files"]').focus();
  await page.locator("body").press("/");
  await page.locator("#command-input").fill("swap container with mark term");
  await page.locator("#command-input").press("Enter");
  const after = await rect(page, "home-terminal");
  expect(after.x).toBeGreaterThan(before.x);
  /* Marks survive a reload. */
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  await expect(page.locator('[data-wm-window="home-terminal"] .window-titlebar > :first-child')).toHaveAttribute("data-wm-marks", "term");
});

test("a sticky spawned window follows every workspace; a site window is refused", async ({ page }) => {
  await open(page);
  await page.locator('[data-wm-window="home-terminal"]').focus();
  await page.keyboard.press("Shift+S");
  await expect(page.locator("#dunst")).toContainText("site windows stay on their workspace");
  await page.locator("body").press("/");
  await page.locator("#command-input").fill("exec neofetch");
  await page.locator("#command-input").press("Enter");
  const neofetch = page.locator('[data-wm-window^="neofetch-"]');
  await expect(neofetch).toBeVisible();
  await neofetch.focus();
  await page.keyboard.press("Shift+S");
  await expect(neofetch).toHaveClass(/is-floating/);
  await page.keyboard.press("2");
  await expect(page).toHaveURL(/#writing$/);
  await expect(neofetch).toBeVisible();
  await page.keyboard.press("4");
  await expect(neofetch).toBeVisible();
  await neofetch.focus();
  await page.keyboard.press("Shift+S");
  await page.keyboard.press("1");
  await expect(neofetch).toBeHidden();
});

test("the bar speaks the original config's Chinese by default, English on request, and persists it", async ({ page }) => {
  /* Wide enough that the labels are not shed — below ~1700px only the glyph
     and the reading survive, which is what keeps the workspace names intact. */
  await page.setViewportSize({ width: 1920, height: 900 });
  await open(page);
  await page.evaluate(() => document.fonts.ready);
  const label = page.locator('#i3status [data-block="cpu"] .i3block-label');
  const cpu = page.locator('#i3status [data-block="cpu"] .i3block-value');
  await expect(label).toHaveText("处理器");
  await expect(label).toHaveAttribute("lang", "zh");
  await expect(cpu).toHaveText("16 thr");
  await expect(page.locator('#i3status [data-block="cpu"] .sr-only')).toHaveText("CPU threads: ");
  await expect(page.locator("#local-clock")).toHaveText(/^\d{2}月\d{2}号 \d{2}时\d{2}分\d{2}秒$/);
  const loaded = await page.evaluate(() => [...document.fonts].some((face) => face.family.includes("SauceCodePro NFM") && face.status === "loaded" && face.unicodeRange.includes("4E00")));
  expect(loaded).toBe(true);

  await page.locator("body").press("/");
  await page.locator("#command-input").fill("bar labels en");
  await page.locator("#command-input").press("Enter");
  await expect(label).toHaveText("cpu");
  await expect(label).not.toHaveAttribute("lang", /.+/);
  await expect(page.locator("#local-clock")).toHaveText(/^\d{2}:\d{2}:\d{2}/);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  await expect(label).toHaveText("cpu");
});

test("the bar sheds its labels before it squeezes anything, keeping the glyph and the reading", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await open(page);
  await page.evaluate(() => document.fonts.ready);
  const label = page.locator('#i3status [data-block="cpu"] .i3block-label');
  await expect(label).toBeVisible();
  /* A common laptop width: the label goes, the reading and its glyph stay, and
     the screen-reader label is untouched. */
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(label).toBeHidden();
  await expect(page.locator('#i3status [data-block="cpu"] .i3block-value')).toHaveText("16 thr");
  await expect(page.locator('#i3status [data-block="cpu"] .i3block-glyph')).toBeVisible();
  await expect(page.locator('#i3status [data-block="cpu"] .sr-only')).toHaveText("CPU threads: ");
  /* And the bar has real room to spare, not a pixel: text measures differently
     on every platform, and CI is not this machine. */
  const spare = await page.evaluate(() => {
    const bar = document.querySelector(".wm-bar");
    const wanted = [".workspace-strip", "#i3status", ".system-status"]
      .reduce((total, selector) => total + document.querySelector(selector).scrollWidth, 0);
    return bar.clientWidth - wanted;
  });
  expect(spare).toBeGreaterThan(40);
});

test("the terminal is the original machine's: agnoster prompt, dotfiles, journalctl, i3exit, notify-send", async ({ page }) => {
  await open(page);
  const terminal = page.locator('[data-wm-window="home-terminal"]');
  const input = terminal.locator(".shell-input");
  await expect(terminal.locator(".shell-prompt.agnoster .prompt-path").last()).toHaveText("~");
  await input.click();
  await input.fill("cat ~/.config/i3/config");
  await input.press("Enter");
  await expect(terminal.locator(".terminal-dotfile").last()).toContainText("gaps inner 14");
  await input.fill("cd .config/i3");
  await input.press("Enter");
  await expect(terminal.locator(".shell-prompt.agnoster .prompt-path").last()).toHaveText("~/.config/i3");
  await input.fill("cat i3status.conf");
  await input.press("Enter");
  await expect(terminal.locator(".terminal-dotfile").last()).toContainText("处理器");
  await input.fill("cd ~");
  await input.press("Enter");
  await input.fill("journalctl -b");
  await input.press("Enter");
  await expect(terminal).toContainText("Started Light Display Manager.");
  await input.fill("uname -a");
  await input.press("Enter");
  await expect(terminal).toContainText("Linux manjaro 6.12.4-1-MANJARO");
  await input.fill("notify-send hello from the terminal");
  await input.press("Enter");
  await expect(page.locator("#dunst")).toContainText("hello from the terminal");
  await input.fill("conky");
  await input.press("Enter");
  const conky = page.locator('[data-wm-window^="conky-"]');
  await expect(conky).toBeVisible();
  await expect(conky).toHaveClass(/is-floating/);
  await expect(conky.locator(".conky-weekday")).toHaveText(/星期/);
  /* Sticky by its config: it stays when the workspace changes. */
  await terminal.focus();
  await page.keyboard.press("3");
  await expect(conky).toBeVisible();
  await page.keyboard.press("1");
  await input.click();
  await input.fill("i3exit hibernate");
  await input.press("Enter");
  await expect(page.locator("#greeter")).toHaveAttribute("data-phase", "sleep");
});
