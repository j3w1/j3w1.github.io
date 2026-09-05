import assert from "node:assert/strict";
import test from "node:test";
import { startBrowserFixture } from "../../../test/browser-fixture-server.mjs";

test("browser fixture models a cross-origin frontend and OAuth service", async () => {
  const fixture = await startBrowserFixture();
  try {
    assert.notEqual(fixture.frontendOrigin, fixture.authOrigin);

    const config = await fetch(`${fixture.frontendOrigin}/admin/config.js`).then((response) => response.text());
    assert.match(config, new RegExp(fixture.authOrigin.replaceAll(".", "\\.")));

    const channel = "c".repeat(43);
    const start = await fetch(`${fixture.authOrigin}/auth/github/start?channel=${channel}`, { redirect: "manual" });
    assert.equal(start.status, 302);
    assert.equal(start.headers.get("cross-origin-opener-policy"), null);
    assert.equal(start.headers.get("location"), `${fixture.authOrigin}/auth/github/callback?channel=${channel}`);

    const callback = await fetch(start.headers.get("location"));
    assert.equal(callback.status, 200);
    assert.equal(callback.headers.get("cross-origin-opener-policy"), null);
    assert.match(callback.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(callback.headers.get("x-frame-options"), "DENY");
    assert.match(await callback.text(), new RegExp(fixture.frontendOrigin.replaceAll(".", "\\.")));

    const authorization = { Authorization: "Bearer browser-fixture-token" };
    const session = await fetch(`${fixture.authOrigin}/api/session`, { headers: authorization }).then((response) => response.json());
    assert.deepEqual(session.repository, { owner: "j3w1", name: "j3w1.github.io", branch: "main" });

    await fetch(`${fixture.authOrigin}/__test/reset`, { method: "POST" });
    await fetch(`${fixture.authOrigin}/auth/github/callback?channel=${channel}`);
    await fetch(`${fixture.authOrigin}/__test/read-delay?ms=10`, { method: "POST" });
    await fetch(`${fixture.authOrigin}/api/content/books`, { headers: authorization });
    await fetch(`${fixture.authOrigin}/api/content/books/fixture-book`, { headers: authorization });
    await fetch(`${fixture.authOrigin}/api/preview/books`, { method: "POST", headers: { ...authorization, "Content-Type": "application/json" }, body: JSON.stringify({ metadata: {}, body: "" }) });
    const state = await fetch(`${fixture.authOrigin}/__test/state`).then((response) => response.json());
    assert.deepEqual(state.collectionGets, { writing: 0, books: 1, photography: 0 });
    assert.deepEqual(state.detailGets, { writing: 0, books: 1, photography: 0 });
    assert.deepEqual(state.previewPosts, { writing: 0, books: 1, photography: 0 });
  } finally {
    await fixture.close();
  }
});
