import { unavailable } from "./errors.js";
import {
  PRODUCTION_REQUIRED_NAMES,
  PRODUCTION_SECRET_NAMES,
  TARGET_BRANCH,
  TARGET_OWNER,
  TARGET_REPOSITORY,
  TARGET_REPOSITORY_WITH_OWNER,
} from "./constants.js";

const clean = (value) => (typeof value === "string" ? value.trim() : "");

const parseOrigin = (value) => {
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
  if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return "";
  return url.origin;
};

const parseCallback = (value, { production }) => {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/auth/github/callback") return { url: "", origin: "" };
    if (url.protocol !== "https:" && (production || url.protocol !== "http:")) return { url: "", origin: "" };
    if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return { url: "", origin: "" };
    return { url: url.href, origin: url.origin };
  } catch {
    return { url: "", origin: "" };
  }
};

const deploymentEnvironment = (environment, nodeEnv) => {
  const vercelEnvironment = clean(environment.VERCEL_ENV);
  if (["production", "preview", "development"].includes(vercelEnvironment)) return vercelEnvironment;
  return nodeEnv === "production" ? "production" : "development";
};

export const loadConfig = (environment = process.env) => {
  const nodeEnv = clean(environment.NODE_ENV) || "development";
  const environmentName = deploymentEnvironment(environment, nodeEnv);
  const production = environmentName === "production";
  const preview = environmentName === "preview";
  const parsedSiteOrigin = parseOrigin(clean(environment.CMS_SITE_ORIGIN));
  const siteOrigin = production && parsedSiteOrigin !== "https://j3w1.github.io" ? "" : parsedSiteOrigin;
  const callback = parseCallback(clean(environment.GITHUB_CALLBACK_URL), { production });
  const developmentOrigins = production || preview
    ? []
    : clean(environment.CMS_DEV_ORIGINS)
        .split(",")
        .map((value) => parseOrigin(value.trim()))
        .filter(Boolean);

  const values = {
    nodeEnv,
    environmentName,
    production,
    preview,
    siteOrigin,
    callbackUrl: callback.url,
    callbackOrigin: callback.origin,
    allowedGithubLogin: clean(environment.CMS_ALLOWED_GITHUB_LOGIN).toLowerCase(),
    allowedGithubUserId: /^\d+$/.test(clean(environment.CMS_ALLOWED_GITHUB_USER_ID)) ? clean(environment.CMS_ALLOWED_GITHUB_USER_ID) : "",
    sessionSecret: clean(environment.CMS_SESSION_SECRET),
    githubAppId: clean(environment.GITHUB_APP_ID),
    githubClientId: clean(environment.GITHUB_CLIENT_ID),
    githubClientSecret: clean(environment.GITHUB_CLIENT_SECRET),
    githubPrivateKeyBase64: clean(environment.GITHUB_PRIVATE_KEY_BASE64),
    githubApiVersion: clean(environment.GITHUB_API_VERSION) || (production ? "" : "2026-03-10"),
    redisUrl: clean(environment.KV_REST_API_URL),
    redisToken: clean(environment.KV_REST_API_TOKEN),
    blobToken: clean(environment.BLOB_READ_WRITE_TOKEN),
    cronSecret: clean(environment.CRON_SECRET),
    developmentOrigins,
    providerEnvironment: clean(environment.VERCEL_ENV) || (production ? "production" : "development"),
    sourceRevision: clean(environment.VERCEL_GIT_COMMIT_SHA),
    deploymentId: clean(environment.VERCEL_DEPLOYMENT_ID),
    region: clean(environment.VERCEL_REGION),
  };

  const requiredValues = {
    CMS_SITE_ORIGIN: values.siteOrigin,
    CMS_ALLOWED_GITHUB_LOGIN: values.allowedGithubLogin,
    CMS_ALLOWED_GITHUB_USER_ID: values.allowedGithubUserId,
    CMS_SESSION_SECRET: values.sessionSecret.length >= 32 ? values.sessionSecret : "",
    GITHUB_APP_ID: values.githubAppId,
    GITHUB_CLIENT_ID: values.githubClientId,
    GITHUB_CLIENT_SECRET: values.githubClientSecret,
    GITHUB_PRIVATE_KEY_BASE64: values.githubPrivateKeyBase64,
    GITHUB_CALLBACK_URL: values.callbackUrl,
    GITHUB_API_VERSION: values.githubApiVersion,
    KV_REST_API_URL: values.redisUrl,
    KV_REST_API_TOKEN: values.redisToken,
    BLOB_READ_WRITE_TOKEN: values.blobToken,
    CRON_SECRET: values.cronSecret.length >= 16 ? values.cronSecret : "",
  };
  const requiredNames = production ? PRODUCTION_REQUIRED_NAMES : Object.keys(requiredValues);
  const missing = requiredNames.filter((name) => !requiredValues[name]);
  const previewViolations = preview ? PRODUCTION_SECRET_NAMES.filter((name) => clean(environment[name])) : [];

  return Object.freeze({
    ...values,
    githubOwner: TARGET_OWNER,
    githubRepo: TARGET_REPOSITORY,
    githubBranch: TARGET_BRANCH,
    repositoryNameWithOwner: TARGET_REPOSITORY_WITH_OWNER,
    allowedOrigins: Object.freeze([siteOrigin, ...developmentOrigins].filter(Boolean)),
    configured: !preview && missing.length === 0 && previewViolations.length === 0,
    missing: Object.freeze(missing),
    previewViolations: Object.freeze(previewViolations),
  });
};

export const requireConfigured = (config) => {
  if (!config.configured) throw unavailable();
  return config;
};
