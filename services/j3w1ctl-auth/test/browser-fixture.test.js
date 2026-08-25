import assert from "node:assert/strict";
import test from "node:test";
import { startBrowserFixture } from "./browser-fixture-server.mjs";

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

    const session = await fetch(`${fixture.authOrigin}/api/session`).then((response) => response.json());
    assert.deepEqual(session.repository, { owner: "j3w1", name: "j3w1.github.io", branch: "main" });
  } finally {
    await fixture.close();
  }
});
