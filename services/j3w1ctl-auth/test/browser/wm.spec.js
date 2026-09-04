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
  /* The gap between tiles is exactly --gap; no overlap, no dead pixels. */
  expect(files.x - (terminal.x + terminal.w)).toBe(3);
  const layer = await page.evaluate(() =>
    document.querySelector('[data-wm-layer="home"]').clientWidth);
  expect(files.x + files.w).toBe(layer);
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
  await expect(page.locator("#status-workspace")).toHaveText("2:writing");

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
  expect(files.x - (after.x + after.w)).toBe(3);
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
