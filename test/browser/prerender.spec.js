import { expect, test } from "@playwright/test";
import { startBrowserFixture } from "../browser-fixture-server.mjs";
import { renderAstHtml } from "../../services/j3w1ctl-auth/src/html-renderer.js";

let fixture;

test.beforeAll(async () => {
  fixture = await startBrowserFixture();
});

test.afterAll(async () => {
  await fixture.close();
});

/* Every node type the restricted AST allows, so the two renderers are held
   to parity over the whole grammar rather than the fixture entry alone. */
const PARITY_AST = [
  { type: "heading", level: 2, children: [{ type: "text", value: "Heading & <co.>" }] },
  { type: "paragraph", children: [
    { type: "text", value: "Plain, " },
    { type: "emphasis", children: [{ type: "text", value: "em" }] },
    { type: "text", value: " and " },
    { type: "strong", children: [{ type: "text", value: "strong" }] },
    { type: "text", value: " with " },
    { type: "code", value: "code <b>" },
    { type: "break" },
    { type: "link", href: "https://example.com/a?b=1&c=2", children: [{ type: "text", value: "external" }] },
    { type: "text", value: " " },
    { type: "link", href: "/wiki/", children: [{ type: "text", value: "internal" }] },
    { type: "text", value: " " },
    { type: "link", href: "mailto:someone@example.com", children: [{ type: "text", value: "mail" }] },
  ] },
  { type: "list", ordered: true, start: 3, children: [{ type: "listItem", children: [{ type: "text", value: "three" }] }] },
  { type: "list", ordered: false, children: [{ type: "listItem", children: [{ type: "text", value: "bullet nbsp" }] }] },
  { type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: "quote" }] }] },
  { type: "codeBlock", language: "sh", value: "echo '<hi>' && ls" },
  { type: "codeBlock", language: "", value: "plain" },
];

test("the server-side HTML renderer matches the browser renderer byte for byte", async ({ page }) => {
  await page.goto(`${fixture.frontendOrigin}/#home`);
  const browserHtml = await page.evaluate(async (ast) => {
    const { renderAst } = await import("/assets/js/content-renderer.js");
    const container = document.createElement("div");
    renderAst(ast, container);
    return container.innerHTML;
  }, PARITY_AST);
  expect(renderAstHtml(PARITY_AST, { origin: fixture.frontendOrigin })).toBe(browserHtml);
});

test("a prerendered entry page renders the content and opens the desktop at the same entry", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${fixture.frontendOrigin}/writing/fixture-essay/`);
  await expect(page.locator("h1")).toHaveText("Browser fixture essay");
  await expect(page.locator(".rendered-content")).toContainText("Rendered from the same restricted AST.");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://j3w1.github.io/writing/fixture-essay/");
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe("hidden");
  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  expect(ld["@type"]).toBe("Article");
  expect(errors).toEqual([]);

  await page.locator("[data-desktop-link]").first().click();
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  await expect(page).toHaveURL(/#writing\/fixture-essay$/);
  await expect(page.locator("#greeter")).toBeHidden();
  await expect(page.locator('[data-content-detail="writing"] h3')).toHaveText("Browser fixture essay");
  await expect(page.locator('[data-content-detail="writing"] .content-permalink')).toHaveAttribute("href", "/writing/fixture-essay/");
});

test("a photography page lists its images with real dimensions and a gallery card", async ({ page }) => {
  await page.goto(`${fixture.frontendOrigin}/photography/fixture-photographs/`);
  await expect(page.locator(".photo-grid img")).toHaveCount(2);
  await expect(page.locator(".photo-grid img").nth(1)).toHaveAttribute("height", "640");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /fixture\.webp$/);
  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  expect(ld["@type"]).toBe("ImageGallery");
  expect(ld.image).toHaveLength(2);
});

test("collection pages list every entry and the feed and sitemap are served", async ({ page, request }) => {
  await page.goto(`${fixture.frontendOrigin}/writing/`);
  await expect(page.locator(".entry-list a")).toHaveText(["Browser fixture essay"]);
  const feed = await request.get(`${fixture.frontendOrigin}/feed.xml`);
  expect(feed.ok()).toBe(true);
  expect(await feed.text()).toContain("<title>Browser fixture essay</title>");
  const sitemap = await request.get(`${fixture.frontendOrigin}/sitemap.xml`);
  expect(await sitemap.text()).toContain("https://j3w1.github.io/writing/fixture-essay/");
});

test("path-shaped links that have no page are rescued into the desktop", async ({ page }) => {
  for (const [path, hash] of [["/about/", "#about"], ["/Writing/Nope.html", "#writing/nope"], ["/photography/missing", "#photography/missing"]]) {
    await page.goto(`${fixture.frontendOrigin}${path}`);
    await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
    await expect(page).toHaveURL(new RegExp(`/${hash.replace("#", "#")}$`));
  }
  await expect(page.locator("#writing")).toBeHidden();
  await expect(page.locator("#photography")).toBeVisible();

  /* A path that is not route-shaped stays a 404 with links, not a redirect. */
  await page.goto(`${fixture.frontendOrigin}/nothing/here/at/all`);
  await expect(page.locator("h1")).toContainText("404");
  await expect(page.locator('a[href="/writing/"]')).toBeVisible();
});

test("alternate hash spellings land on the same entry", async ({ page }) => {
  await page.goto(`${fixture.frontendOrigin}/#/Writing/Fixture-Essay/`);
  await page.waitForFunction(() => document.documentElement.classList.contains("wm-active"));
  await expect(page.locator('[data-content-detail="writing"] h3')).toHaveText("Browser fixture essay");
  await page.goto(`${fixture.frontendOrigin}/#photography/fixture-photographs.html`);
  await expect(page.locator('[data-content-detail="photography"] h3')).toHaveText("Fixture Photographs");
});
