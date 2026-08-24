import { unavailable } from "./errors.js";

const clean = (value) => (typeof value === "string" ? value.trim() : "");

const parseOrigin = (value, field) => {
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    return "";
  }
  if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return "";
  return url.origin;
};

export const loadConfig = (environment = process.env) => {
  const nodeEnv = clean(environment.NODE_ENV) || "development";
  const parsedSiteOrigin = parseOrigin(clean(environment.CMS_SITE_ORIGIN), "CMS_SITE_ORIGIN");
  const siteOrigin = nodeEnv === "production" && parsedSiteOrigin !== "https://j3w1.github.io" ? "" : parsedSiteOrigin;
  const callbackUrl = clean(environment.GITHUB_CALLBACK_URL);
  let callbackOrigin = "";
  try {
    const parsed = new URL(callbackUrl);
    if (parsed.protocol === "https:" || (nodeEnv !== "production" && parsed.protocol === "http:")) {
      callbackOrigin = parsed.origin;
    }
  } catch {
    // readiness reports the missing/invalid configuration without crashing healthz.
  }

  const developmentOrigins = nodeEnv === "production"
    ? []
    : clean(environment.CMS_DEV_ORIGINS)
        .split(",")
        .map((value) => parseOrigin(value.trim(), "CMS_DEV_ORIGINS"))
        .filter(Boolean);

  const values = {
    nodeEnv,
    port: Number(environment.PORT || 3000),
    siteOrigin,
    callbackUrl,
    callbackOrigin,
    allowedGithubLogin: clean(environment.CMS_ALLOWED_GITHUB_LOGIN).toLowerCase(),
    allowedGithubUserId: clean(environment.CMS_ALLOWED_GITHUB_USER_ID),
    sessionSecret: clean(environment.CMS_SESSION_SECRET),
    githubAppId: clean(environment.GITHUB_APP_ID),
    githubClientId: clean(environment.GITHUB_CLIENT_ID),
    githubClientSecret: clean(environment.GITHUB_CLIENT_SECRET),
    githubPrivateKeyBase64: clean(environment.GITHUB_PRIVATE_KEY_BASE64),
    githubOwner: clean(environment.GITHUB_OWNER) || "j3w1",
    githubRepo: clean(environment.GITHUB_REPO) || "j3w1.github.io",
    githubBranch: clean(environment.GITHUB_BRANCH) || "main",
    githubApiVersion: clean(environment.GITHUB_API_VERSION) || "2026-03-10",
    developmentOrigins,
  };

  const missing = [];
  const required = {
    CMS_SITE_ORIGIN: values.siteOrigin,
    CMS_ALLOWED_GITHUB_LOGIN: values.allowedGithubLogin,
    CMS_ALLOWED_GITHUB_USER_ID: values.allowedGithubUserId,
    CMS_SESSION_SECRET: values.sessionSecret.length >= 32 ? values.sessionSecret : "",
    GITHUB_APP_ID: values.githubAppId,
    GITHUB_CLIENT_ID: values.githubClientId,
    GITHUB_CLIENT_SECRET: values.githubClientSecret,
    GITHUB_PRIVATE_KEY_BASE64: values.githubPrivateKeyBase64,
    GITHUB_CALLBACK_URL: values.callbackOrigin,
  };
  for (const [name, value] of Object.entries(required)) if (!value) missing.push(name);

  return Object.freeze({
    ...values,
    repositoryNameWithOwner: `${values.githubOwner}/${values.githubRepo}`,
    allowedOrigins: Object.freeze([values.siteOrigin, ...developmentOrigins].filter(Boolean)),
    configured: missing.length === 0,
    missing: Object.freeze(missing),
  });
};

export const requireConfigured = (config) => {
  if (!config.configured) throw unavailable();
  return config;
};
