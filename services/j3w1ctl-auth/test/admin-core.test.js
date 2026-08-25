import assert from "node:assert/strict";
import test from "node:test";
import { ActivityGate, buildPhotographyPreviewItems, MutationGate, ObjectUrlRegistry, publicationTarget, shortCommit } from "../../../admin/j3w1ctl-core.js";
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

test("activity gate gives one foreground read explicit ownership", () => {
  const gate = new ActivityGate();
  const owner = gate.enter("reading books");
  assert.ok(owner);
  assert.equal(gate.enter("reading photography"), null);
  assert.equal(gate.owns(owner), true);
  assert.equal(gate.leave({ action: "reading books", sequence: owner.sequence }), false);
  assert.equal(gate.inFlight, true);
  assert.equal(gate.leave(owner), true);
  assert.equal(gate.inFlight, false);
});

test("delayed foreground reads admit one request and release after failure", async () => {
  const gate = new ActivityGate();
  const requests = { books: 0, photography: 0, preview: 0 };
  const run = async (name, { fail = false } = {}) => {
    const owner = gate.enter(`reading ${name}`);
    if (!owner) return "ignored";
    requests[name] += 1;
    try {
      await new Promise((resolve) => setTimeout(resolve, 15));
      if (fail) throw new Error("read failed");
      return "complete";
    } finally {
      gate.leave(owner);
    }
  };

  const first = run("books");
  const duplicate = run("books");
  const impatientNavigation = run("photography");
  assert.deepEqual(await Promise.all([first, duplicate, impatientNavigation]), ["complete", "ignored", "ignored"]);
  assert.deepEqual(requests, { books: 1, photography: 0, preview: 0 });
  assert.equal(await run("photography"), "complete");
  assert.deepEqual(requests, { books: 1, photography: 1, preview: 0 });

  await assert.rejects(run("books", { fail: true }), /read failed/);
  assert.equal(gate.inFlight, false);
  assert.equal(await run("books"), "complete");

  const preview = run("preview");
  const duplicatePreview = run("preview");
  assert.deepEqual(await Promise.all([preview, duplicatePreview]), ["complete", "ignored"]);
  assert.deepEqual(requests, { books: 3, photography: 1, preview: 1 });
});

test("object URL registry revokes every local photography preview URL", () => {
  const revoked = [];
  let sequence = 0;
  const registry = new ObjectUrlRegistry({
    createObjectURL: () => `blob:preview-${++sequence}`,
    revokeObjectURL: (url) => revoked.push(url),
  });
  assert.equal(registry.create({}), "blob:preview-1");
  assert.equal(registry.create({}), "blob:preview-2");
  registry.revokeAll();
  assert.deepEqual(revoked, ["blob:preview-1", "blob:preview-2"]);
  assert.equal(registry.urls.size, 0);
});

test("photography preview preserves validated order across published and local images", () => {
  const firstLocal = new Blob(["first"], { type: "image/webp" });
  const secondLocal = new Blob(["second"], { type: "image/webp" });
  const created = [];
  const images = [
    { id: "existing", file: "existing.webp", alt: "Existing", caption: "Published" },
    { id: "first-local", file: "first-local.webp", alt: "First local", caption: "One" },
    { id: "second-local", file: "second-local.webp", alt: "Second local", caption: "Two" },
  ];
  const photoItems = [
    { id: "second-local", full: { blob: secondLocal } },
    { id: "existing", publicSrc: "/assets/photography/entry/existing.webp" },
    { id: "first-local", full: { blob: firstLocal } },
  ];
  const preview = buildPhotographyPreviewItems({
    images,
    photoItems,
    persisted: true,
    slug: "entry",
    createObjectUrl: (blob) => { created.push(blob); return `blob:preview-${created.length}`; },
  });
  assert.deepEqual(preview.map(({ id, source }) => [id, source]), [
    ["existing", "/assets/photography/entry/existing.webp"],
    ["first-local", "blob:preview-1"],
    ["second-local", "blob:preview-2"],
  ]);
  assert.deepEqual(created, [firstLocal, secondLocal]);
});

test("new photography preview uses a local object URL without inventing a public source", () => {
  const local = new Blob(["local"], { type: "image/webp" });
  const images = [{ id: "local", file: "local.webp", alt: "Local", caption: "Draft" }];
  const localPreview = buildPhotographyPreviewItems({
    images,
    photoItems: [{ id: "local", full: { blob: local } }],
    persisted: false,
    slug: "new-entry",
    createObjectUrl: () => "blob:new-entry",
  });
  const unavailablePreview = buildPhotographyPreviewItems({
    images,
    photoItems: [],
    persisted: false,
    slug: "new-entry",
    createObjectUrl: () => "unused",
  });
  assert.equal(localPreview[0].source, "blob:new-entry");
  assert.equal(unavailablePreview[0].source, "");
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
