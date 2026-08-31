import { expect, test } from "@playwright/test";
import { startBrowserFixture } from "../browser-fixture-server.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await startBrowserFixture();
});

test.afterAll(async () => {
  await fixture.close();
});

test.beforeEach(async ({ request }) => {
  await request.post(`${fixture.authOrigin}/__test/reset`);
});

const unlock = async (page) => {
  await page.goto(`${fixture.frontendOrigin}/admin/`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Authenticate with GitHub" }).click();
  await popup;
  await expect(page.locator('[data-action="publish"]')).toBeVisible();
};

test("OAuth unlocks the fixed target, reads content, previews with zero writes, and logout invalidates the shared session", async ({ page, request }) => {
  await unlock(page);
  await expect(page.locator(".ctl-status-target")).toContainText("j3w1/j3w1.github.io · git:main · LIVE");
  await expect(page.locator(".ctl-status-tail")).toContainText("api:v1 · 179a3740");

  await page.locator('[data-slug="fixture-essay"]').click();
  await expect(page.locator('input[name="title"]')).toHaveValue("Browser fixture essay");
  let state = await (await request.get(`${fixture.authOrigin}/__test/state`)).json();
  expect(state.detailGets.writing).toBe(1);

  await page.locator('[data-action="new"]').click();
  await page.locator('input[name="title"]').fill("Zero write preview");
  await page.locator('input[name="slug"]').fill("zero-write-preview");
  await page.locator('input[name="date"]').fill("2026-08-31");
  await page.locator('textarea[name="summary"]').fill("A browser acceptance preview.");
  await page.locator('textarea[name="body"]').fill("Preview must not publish.");
  await page.locator('[data-action="preview"]').click();
  await expect(page.locator(".ctl-preview")).toContainText("Preview must not publish.");
  state = await (await request.get(`${fixture.authOrigin}/__test/state`)).json();
  expect(state.previewPosts.writing).toBe(1);
  expect({ post: state.post, put: state.put, delete: state.delete }).toEqual({ post: 0, put: 0, delete: 0 });

  await page.locator('[data-action="logout"]').click();
  await expect(page.getByText("Signed out. Local drafts remain on this device.")).toBeVisible();
  await expect.poll(async () => (await (await request.get(`${fixture.authOrigin}/__test/state`)).json()).validSession).toBe(false);
  const rejected = await request.get(`${fixture.authOrigin}/api/session`, { headers: { Authorization: "Bearer browser-fixture-token" } });
  expect(rejected.status()).toBe(401);
});

test("missing, lower, higher, and malformed protocols keep all mutation controls unreachable", async ({ browser, request }) => {
  for (const value of [undefined, 0, 2, "not-a-number"]) {
    await request.post(`${fixture.authOrigin}/__test/reset`);
    await request.post(`${fixture.authOrigin}/__test/protocol${value === undefined ? "" : `?value=${encodeURIComponent(value)}`}`);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${fixture.frontendOrigin}/admin/`);
    await expect(page.getByText("The publication service protocol is incompatible. Publishing remains locked.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Authenticate with GitHub" })).toBeDisabled();
    const state = await (await request.get(`${fixture.authOrigin}/__test/state`)).json();
    expect({ post: state.post, put: state.put, delete: state.delete }).toEqual({ post: 0, put: 0, delete: 0 });
    await context.close();
  }
});
