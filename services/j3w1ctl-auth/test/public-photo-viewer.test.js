import assert from "node:assert/strict";
import test from "node:test";
import { closePhotoViewer, isPhotoViewerBackdropClick } from "../../../assets/js/photo-viewer.js";

test("closing a photograph preserves route state and restores thumbnail focus", () => {
  const route = { hash: "#photography/test-entry" };
  let closeCount = 0;
  let focusOptions;
  const dialog = { open: true, close() { closeCount += 1; this.open = false; } };
  const thumbnail = { isConnected: true, focus(options) { focusOptions = options; } };

  assert.equal(closePhotoViewer(dialog, thumbnail), true);
  assert.equal(route.hash, "#photography/test-entry");
  assert.equal(closeCount, 1);
  assert.deepEqual(focusOptions, { preventScroll: true });
});

test("only a click targeted at the dialog backdrop requests close", () => {
  const dialog = {};
  assert.equal(isPhotoViewerBackdropClick({ target: dialog, currentTarget: dialog }), true);
  assert.equal(isPhotoViewerBackdropClick({ target: {}, currentTarget: dialog }), false);
});
