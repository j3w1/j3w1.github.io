import {
  J3W1CTL_API_PROTOCOL,
  TARGET_BRANCH,
  TARGET_OWNER,
  TARGET_REPOSITORY,
} from "./constants.js";

const bounded = (value, pattern, maximum) => {
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate && candidate.length <= maximum && pattern.test(candidate) ? candidate : undefined;
};

export const safeProvenance = (config) => Object.freeze({
  provider: "vercel",
  runtime: "node",
  environment: ["production", "preview", "development"].includes(config.providerEnvironment)
    ? config.providerEnvironment
    : "development",
  sourceRevision: bounded(config.sourceRevision, /^[0-9a-f]{7,64}$/i, 64),
  deploymentId: bounded(config.deploymentId, /^[A-Za-z0-9_-]+$/, 128),
  region: bounded(config.region, /^[a-z0-9-]+$/i, 32),
  protocolVersion: J3W1CTL_API_PROTOCOL,
  repository: Object.freeze({ owner: TARGET_OWNER, name: TARGET_REPOSITORY, branch: TARGET_BRANCH }),
});
