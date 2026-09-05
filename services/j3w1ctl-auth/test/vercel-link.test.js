import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_PROJECT_NAME, EXPECTED_ROOT_DIRECTORY, classifyVercelLink } from "../bin/vercel-link.mjs";

const ROOT = "the repository root";
const SERVICE = "services/j3w1ctl-auth";
const link = (overrides = {}) => JSON.stringify({ projectId: "prj_example", orgId: "team_example", projectName: CANONICAL_PROJECT_NAME, ...overrides });
const at = (root, service) => [{ location: ROOT, raw: root }, { location: SERVICE, raw: service }];

test("a valid repository-root link passes and reports Root Directory as expected, not verified", () => {
  const result = classifyVercelLink(at(link(), null));
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.detail.locations, [ROOT]);
  assert.equal(result.detail.projectId, "prj_example");
  assert.equal(result.detail.orgId, "team_example");
  assert.equal(result.detail.expectedRootDirectory, EXPECTED_ROOT_DIRECTORY);
  assert.ok(!("rootDirectory" in result.detail));
});

test("a service-local link is the other supported topology and passes on its own", () => {
  const result = classifyVercelLink(at(null, link()));
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.detail.locations, [SERVICE]);
});

test("a link file older than projectName still passes on the project and organization pair", () => {
  const result = classifyVercelLink(at(JSON.stringify({ projectId: "prj_example", orgId: "team_example" }), null));
  assert.equal(result.status, "PASS");
  assert.equal(result.detail.projectId, "prj_example");
});

test("no link at either location skips rather than fails", () => {
  const result = classifyVercelLink(at(null, null));
  assert.equal(result.status, "SKIP");
  assert.match(result.detail, /no Vercel link exists/);
});

test("a malformed link fails and is never mistaken for an absent one", () => {
  const result = classifyVercelLink(at("{ not json", null));
  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /not valid JSON/);
  assert.doesNotMatch(result.detail, /none was created/);
});

test("a link that parses to something other than an object fails", () => {
  assert.equal(classifyVercelLink(at("null", null)).status, "FAIL");
  assert.equal(classifyVercelLink(at("[]", null)).status, "FAIL");
  assert.equal(classifyVercelLink(at('"prj_example"', null)).status, "FAIL");
});

test("incomplete identifiers fail", () => {
  for (const missing of [{ projectId: undefined }, { orgId: undefined }, { projectId: "   " }, { orgId: "" }]) {
    const result = classifyVercelLink(at(link(missing), null));
    assert.equal(result.status, "FAIL", `${JSON.stringify(missing)} must fail`);
    assert.match(result.detail, /identifiers are incomplete/);
  }
});

test("a link to another Vercel project fails", () => {
  const result = classifyVercelLink(at(link({ projectName: "some-other-project" }), null));
  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /not j3w1ctl-auth/);
});

test("two links describing the same project pass and both locations are reported", () => {
  const result = classifyVercelLink(at(link(), link()));
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.detail.locations, [ROOT, SERVICE]);
});

test("two links describing different projects fail rather than one silently winning", () => {
  for (const conflict of [{ projectId: "prj_other" }, { orgId: "team_other" }]) {
    const result = classifyVercelLink(at(link(), link(conflict)));
    assert.equal(result.status, "FAIL", `${JSON.stringify(conflict)} must fail`);
    assert.match(result.detail, /describe different projects/);
  }
});
