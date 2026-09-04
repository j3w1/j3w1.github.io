import assert from "node:assert/strict";
import test from "node:test";
import {
  J3W1CTL_API_PROTOCOL,
  PRODUCTION_REQUIRED_NAMES,
  PRODUCTION_SECRET_NAMES,
} from "../src/constants.js";
import { loadConfig } from "../src/config.js";
import { safeProvenance } from "../src/provenance.js";
import { testProductionEnvironment } from "./helpers.js";

test("production configuration is exact and publication target inputs cannot override source constants", () => {
  const config = loadConfig({
    ...testProductionEnvironment,
    GITHUB_OWNER: "attacker",
    GITHUB_REPO: "other",
    GITHUB_BRANCH: "stale",
    CMS_DEV_ORIGINS: "https://evil.example",
    PORT: "8080",
  });
  assert.equal(config.configured, true);
  assert.equal(config.siteOrigin, "https://j3w1.github.io");
  assert.deepEqual([config.githubOwner, config.githubRepo, config.githubBranch], ["j3w1", "j3w1.github.io", "main"]);
  assert.deepEqual(config.allowedOrigins, ["https://j3w1.github.io"]);
  assert.equal(config.databaseUrl, testProductionEnvironment.DATABASE_URL);
  assert.equal("port" in config, false);
  assert.equal("GITHUB_BRANCH" in config, false);
});

test("production fails closed for the wrong site or callback and reports required names only", () => {
  const wrongSite = loadConfig({ ...testProductionEnvironment, CMS_SITE_ORIGIN: "https://example.test" });
  assert.equal(wrongSite.configured, false);
  assert.deepEqual(wrongSite.missing, ["CMS_SITE_ORIGIN"]);

  const wrongCallback = loadConfig({ ...testProductionEnvironment, GITHUB_CALLBACK_URL: "https://cms.example/other" });
  assert.equal(wrongCallback.configured, false);
  assert.deepEqual(wrongCallback.missing, ["GITHUB_CALLBACK_URL"]);

  const absent = loadConfig({ NODE_ENV: "production", VERCEL_ENV: "production" });
  assert.deepEqual(absent.missing, PRODUCTION_REQUIRED_NAMES);

  /* Provider variables are configured explicitly, never sniffed: a connection
     string under any other name leaves the service unconfigured rather than
     quietly pointing at a database nobody chose. */
  const alternateDatabaseNames = loadConfig({
    ...testProductionEnvironment,
    DATABASE_URL: undefined,
    POSTGRES_URL: "postgresql://other.invalid/db",
    NEON_DATABASE_URL: "postgresql://other.invalid/db",
  });
  assert.equal(alternateDatabaseNames.configured, false);
  assert.deepEqual(alternateDatabaseNames.missing, ["DATABASE_URL"]);
});

test("Preview is deliberately unprivileged and secret presence is a configuration violation", () => {
  const safe = loadConfig({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    CMS_SITE_ORIGIN: "https://j3w1.github.io",
    CMS_ALLOWED_GITHUB_LOGIN: "j3w1",
    CMS_ALLOWED_GITHUB_USER_ID: "42",
    GITHUB_API_VERSION: "2026-03-10",
  });
  assert.equal(safe.preview, true);
  assert.equal(safe.configured, false);
  assert.deepEqual(safe.previewViolations, []);

  const unsafe = loadConfig({ ...testProductionEnvironment, VERCEL_ENV: "preview" });
  assert.equal(unsafe.configured, false);
  assert.deepEqual(unsafe.previewViolations, PRODUCTION_SECRET_NAMES);
});

test("development may add configured origins while production never admits them", () => {
  const development = loadConfig({
    NODE_ENV: "development",
    CMS_SITE_ORIGIN: "http://127.0.0.1:8080",
    CMS_DEV_ORIGINS: "http://localhost:8080,https://evil.example,http://192.168.1.2:8080",
  });
  assert.deepEqual(development.allowedOrigins, ["http://127.0.0.1:8080", "http://localhost:8080", "https://evil.example"]);
  const production = loadConfig({ ...testProductionEnvironment, CMS_DEV_ORIGINS: "http://localhost:8080" });
  assert.deepEqual(production.developmentOrigins, []);
});

test("provenance allowlists safe bounded provider fields and excludes all configuration values", () => {
  const provenance = safeProvenance(loadConfig({
    ...testProductionEnvironment,
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    VERCEL_DEPLOYMENT_ID: "dpl_safe-123",
    VERCEL_REGION: "iad1",
  }));
  assert.deepEqual(provenance, {
    provider: "vercel",
    runtime: "node",
    environment: "production",
    sourceRevision: "a".repeat(40),
    deploymentId: "dpl_safe-123",
    region: "iad1",
    protocolVersion: J3W1CTL_API_PROTOCOL,
    repository: { owner: "j3w1", name: "j3w1.github.io", branch: "main" },
  });
  const serialized = JSON.stringify(provenance);
  for (const value of Object.values(testProductionEnvironment)) {
    if (String(value).includes("secret") || String(value).includes("token") || String(value).includes("key")) {
      assert.equal(serialized.includes(String(value)), false);
    }
  }
  const rejected = safeProvenance(loadConfig({
    ...testProductionEnvironment,
    VERCEL_GIT_COMMIT_SHA: "secret=not-a-sha",
    VERCEL_DEPLOYMENT_ID: "bad/value",
    VERCEL_REGION: "region with spaces",
  }));
  assert.equal("sourceRevision" in rejected, true);
  assert.equal(rejected.sourceRevision, undefined);
  assert.equal(rejected.deploymentId, undefined);
  assert.equal(rejected.region, undefined);
});
