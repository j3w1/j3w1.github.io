import assert from "node:assert/strict";
import test from "node:test";
import { MutationGate, publicationTarget, shortCommit } from "../../../admin/j3w1ctl-core.js";
import { EXAMPLES } from "../../../admin/j3w1ctl-examples.js";
import { IMAGE_ACCEPT, IMAGE_LIMITS, acceptedImageType, fitWithin } from "../../../admin/j3w1ctl-images.js";

test("mutation gate rejects concurrent publish, update, and delete attempts", () => {
  for (const action of ["publish", "update", "delete"]) {
    const gate = new MutationGate();
    let requests = 0;
    if (gate.enter(action)) requests += 1;
    if (gate.enter(action)) requests += 1;
    assert.equal(requests, 1);
    assert.equal(gate.inFlight, true);
    gate.leave();
    assert.equal(gate.inFlight, false);
    assert.equal(gate.enter(action), true);
  }
});

test("publication target distinguishes server-reported main and sandbox branches", () => {
  assert.deepEqual(publicationTarget({ owner: "j3w1", name: "j3w1.github.io", branch: "main" }), {
    label: "j3w1/j3w1.github.io · git:main · LIVE",
    mode: "LIVE",
    live: true,
  });
  assert.deepEqual(publicationTarget({ owner: "j3w1", name: "j3w1.github.io", branch: "cms-sandbox" }), {
    label: "j3w1/j3w1.github.io · git:cms-sandbox · SANDBOX",
    mode: "SANDBOX",
    live: false,
  });
  assert.equal(shortCommit("1234567890abcdef"), "12345678");
});

test("photography source policy accepts only JPG, JPEG, PNG, and WebP", () => {
  assert.equal(IMAGE_ACCEPT, "image/jpeg,image/png,image/webp");
  assert.equal(acceptedImageType({ name: "photo.jpg", type: "image/jpeg" }), true);
  assert.equal(acceptedImageType({ name: "photo.jpeg", type: "image/jpeg" }), true);
  assert.equal(acceptedImageType({ name: "photo.png", type: "image/png" }), true);
  assert.equal(acceptedImageType({ name: "photo.webp", type: "image/webp" }), true);
  assert.equal(acceptedImageType({ name: "photo.gif", type: "image/gif" }), false);
  assert.equal(acceptedImageType({ name: "photo.svg", type: "image/svg+xml" }), false);
  assert.equal(acceptedImageType({ name: "photo.png", type: "application/octet-stream" }), false);
});

test("image dimensions never upscale and generated limits remain below backend limits", () => {
  assert.deepEqual(fitWithin(800, 600, 2560), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(4032, 3024, 2560), { width: 2560, height: 1920 });
  assert.deepEqual(fitWithin(3024, 4032, 640), { width: 480, height: 640 });
  assert.ok(IMAGE_LIMITS.full.maxBytes < 2 * 1024 * 1024);
  assert.ok(IMAGE_LIMITS.thumbnail.maxBytes < 256 * 1024);
  assert.equal(IMAGE_LIMITS.count, 12);
});

test("examples provide two unpublished local templates per collection", () => {
  for (const collection of ["writing", "books", "photography"]) {
    assert.equal(EXAMPLES[collection].length, 2);
    for (const example of EXAMPLES[collection]) assert.equal(example.persisted, undefined);
  }
  assert.equal(EXAMPLES.photography.every(({ images }) => images.length === 0), true);
});
