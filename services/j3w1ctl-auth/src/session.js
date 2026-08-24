import { hkdfSync, randomBytes, randomUUID } from "node:crypto";
import {
  CompactEncrypt,
  SignJWT,
  compactDecrypt,
  jwtVerify,
} from "jose";
import { unauthorized } from "./errors.js";

const encoder = new TextEncoder();
const SESSION_AUDIENCE = "j3w1ctl";
const SESSION_ISSUER = "j3w1ctl-auth";
const OAUTH_AUDIENCE = "j3w1ctl-oauth-state";

const deriveKey = (secret, label, length = 32) =>
  new Uint8Array(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.from(label), length));

export const createSessionManager = (config, { now = () => Math.floor(Date.now() / 1000) } = {}) => {
  const signingKey = deriveKey(config.sessionSecret, "j3w1ctl-session-v1");
  const oauthKey = deriveKey(config.sessionSecret, "j3w1ctl-oauth-state-v1");
  const revoked = new Map();

  const prune = () => {
    const current = now();
    for (const [jti, expiry] of revoked) if (expiry <= current) revoked.delete(jti);
  };

  const issue = async (user) => {
    const issuedAt = now();
    const expiresAt = issuedAt + 60 * 60;
    const jti = randomUUID();
    const token = await new SignJWT({ login: user.login })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(String(user.id))
      .setIssuer(SESSION_ISSUER)
      .setAudience(SESSION_AUDIENCE)
      .setJti(jti)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(signingKey);
    return { token, expiresAt, jti };
  };

  const verify = async (token) => {
    try {
      const { payload } = await jwtVerify(token, signingKey, {
        issuer: SESSION_ISSUER,
        audience: SESSION_AUDIENCE,
        currentDate: new Date(now() * 1000),
      });
      prune();
      if (!payload.jti || revoked.has(payload.jti)) throw unauthorized("The j3w1ctl session has expired.");
      return payload;
    } catch (error) {
      if (error?.statusCode === 401) throw error;
      throw unauthorized("The j3w1ctl session is invalid or expired.");
    }
  };

  const revoke = (payload) => {
    if (payload?.jti && payload?.exp) revoked.set(payload.jti, payload.exp);
    prune();
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
      if (payload.aud !== OAUTH_AUDIENCE || payload.exp < now() || payload.iat > now() + 30) {
        throw new Error("expired");
      }
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

