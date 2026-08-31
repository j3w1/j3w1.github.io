import { createHash, hkdfSync, randomBytes } from "node:crypto";
import { CompactEncrypt, compactDecrypt } from "jose";
import {
  J3W1CTL_API_PROTOCOL,
  SESSION_SCHEMA_VERSION,
  SESSION_TTL_SECONDS,
} from "./constants.js";
import { createRedisStore } from "./store.js";
import { unauthorized } from "./errors.js";

const encoder = new TextEncoder();
const OAUTH_AUDIENCE = "j3w1ctl-oauth-state";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const deriveKey = (secret, label, length = 32) =>
  new Uint8Array(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.from(label), length));

export const digestSessionToken = (token) => createHash("sha256").update(token, "utf8").digest("hex");
const sessionKey = (token) => `sess:v1:${digestSessionToken(token)}`;

export const createSessionManager = (config, {
  now = () => Math.floor(Date.now() / 1000),
  store = createRedisStore(config),
} = {}) => {
  const oauthKey = deriveKey(config.sessionSecret, "j3w1ctl-oauth-state-v1");

  const issue = async (user) => {
    if (String(user?.id) !== config.allowedGithubUserId || String(user?.login ?? "").toLowerCase() !== config.allowedGithubLogin) {
      throw unauthorized("The GitHub owner identity is not authorized.");
    }
    const issuedAt = now();
    const expiresAt = issuedAt + SESSION_TTL_SECONDS;
    const record = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      ownerUserId: String(user.id),
      ownerLogin: String(user.login).toLowerCase(),
      issuedAt,
      expiresAt,
      protocolVersion: J3W1CTL_API_PROTOCOL,
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(32).toString("base64url");
      if (await store.setIfAbsent(sessionKey(token), record, SESSION_TTL_SECONDS)) return { token, expiresAt };
    }
    throw unauthorized("A j3w1ctl session could not be issued.");
  };

  const verify = async (token) => {
    if (!TOKEN_PATTERN.test(token)) throw unauthorized("The j3w1ctl session is invalid or expired.");
    const key = sessionKey(token);
    const record = await store.get(key);
    const current = now();
    if (
      !record
      || record.schemaVersion !== SESSION_SCHEMA_VERSION
      || record.protocolVersion !== J3W1CTL_API_PROTOCOL
      || record.ownerUserId !== config.allowedGithubUserId
      || record.ownerLogin !== config.allowedGithubLogin
      || !Number.isInteger(record.issuedAt)
      || !Number.isInteger(record.expiresAt)
      || record.issuedAt > current + 30
      || record.expiresAt <= current
    ) {
      throw unauthorized("The j3w1ctl session is invalid or expired.");
    }
    return {
      sub: record.ownerUserId,
      login: record.ownerLogin,
      iat: record.issuedAt,
      exp: record.expiresAt,
      protocolVersion: record.protocolVersion,
      sessionId: key.slice("sess:v1:".length),
    };
  };

  const revoke = async (token) => {
    if (!TOKEN_PATTERN.test(token)) return;
    await store.delete(sessionKey(token));
  };

  const sealOAuth = async (payload) => {
    const issuedAt = now();
    const plaintext = encoder.encode(JSON.stringify({
      ...payload,
      iat: issuedAt,
      exp: issuedAt + 10 * 60,
      aud: OAUTH_AUDIENCE,
    }));
    return new CompactEncrypt(plaintext)
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "oauth-state+jwe" })
      .encrypt(oauthKey);
  };

  const openOAuth = async (value) => {
    try {
      const { plaintext } = await compactDecrypt(value, oauthKey);
      const payload = JSON.parse(new TextDecoder().decode(plaintext));
      if (payload.aud !== OAUTH_AUDIENCE || payload.exp < now() || payload.iat > now() + 30) throw new Error("expired");
      return payload;
    } catch {
      throw unauthorized("The GitHub authorization state is invalid or expired.");
    }
  };

  return {
    issue,
    verify,
    revoke,
    sealOAuth,
    openOAuth,
    randomToken: (bytes = 32) => randomBytes(bytes).toString("base64url"),
  };
};
