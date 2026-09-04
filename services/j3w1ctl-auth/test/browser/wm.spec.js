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

test("plain mode renders every workspace as a scrolling document", async ({ page }) => {
  await page.goto(`${fixture.frontendOrigin}/?plain=1#home`);
  await expect(page.locator("html")).toHaveAttribute("data-wm", "off");
  await expect(page.locator("html")).not.toHaveClass(/wm-active/);
  await expect(page.locator("#about")).toBeVisible();
  await expect(page.locator("#writing")).toBeVisible();
  await expect(page.locator("#greeter")).toBeHidden();
  const scrollable = await page.evaluate(() =>
    getComputedStyle(document.body).overflowY);
  expect(scrollable).not.toBe("hidden");
});

test("the i3 / plain toggle is reachable and reversible", async ({ page }) => {
  await open(page);
  const toggle = page.locator("#wm-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(page.locator("html")).not.toHaveClass(/wm-active/);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.locator("html")).toHaveClass(/wm-active/);
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
