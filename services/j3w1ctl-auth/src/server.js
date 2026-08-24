import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { assertCollection, mediaPath, normalizeEntry, markdownToAst } from "./content.js";
import { loadConfig, requireConfigured } from "./config.js";
import { AppError, badRequest, conflict, forbidden, unauthorized } from "./errors.js";
import { createGitHubClient } from "./github.js";
import { createRepositoryService } from "./repository.js";
import { createSessionManager } from "./session.js";

const OAUTH_COOKIE = "__Host-j3w1ctl-oauth";
const DEV_OAUTH_COOKIE = "j3w1ctl-oauth";
const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const noStore = (reply) => reply.header("Cache-Control", "no-store");
const readCookie = (request, name) => {
  const cookies = String(request.headers.cookie ?? "").split(";");
  for (const item of cookies) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
};

const oauthCookie = (name, value, { secure, clear = false } = {}) =>
  `${name}=${clear ? "" : encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 600}${secure ? "; Secure" : ""}`;
const jsonError = (request, reply, error) => {
  const transportTooLarge = error?.code === "FST_ERR_CTP_BODY_TOO_LARGE" || error?.code === "FST_REQ_FILE_TOO_LARGE";
  const known = error instanceof AppError;
  const statusCode = known ? error.statusCode : transportTooLarge ? 413 : 500;
  if (!known) request.log.error({ err: { name: error?.name, message: error?.message } }, "request failed");
  return reply.code(statusCode).send({
    error: {
      code: known ? error.code : transportTooLarge ? "request_too_large" : "internal_error",
      message: known ? error.message : transportTooLarge ? "The request exceeds the configured size limit." : "The request could not be completed.",
      requestId: request.id,
    },
  });
};

const callbackPage = ({ origin, channel, token, expiresAt, error, nonce }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>j3w1ctl authorization</title>
<style nonce="${nonce}">html{color-scheme:dark}body{margin:0;background:#090707;color:#ffb0ad;font:15px monospace;display:grid;min-height:100vh;place-items:center}p{border:1px solid #5c1b19;padding:16px}</style></head>
<body><p>${error ? "Authorization was not completed. This window may be closed." : "Authorization complete. Returning to j3w1ctl…"}</p>
<script nonce="${nonce}">(()=>{const target=${JSON.stringify(origin)};const payload=${JSON.stringify(error ? { type: "j3w1ctl:auth-error", channel, error } : { type: "j3w1ctl:auth-success", channel, token, expiresAt })};if(window.opener&&!window.opener.closed)window.opener.postMessage(payload,target);window.close()})();</script></body></html>`;

const parseBearer = (authorization) => {
  const match = typeof authorization === "string" && authorization.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  if (!match) throw unauthorized();
  return match[1];
};

const parseJsonPayload = (request) => {
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("invalid_request", "A JSON object is required.");
  const metadata = body.metadata;
  const markdownBody = body.body ?? "";
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || typeof markdownBody !== "string") {
    throw badRequest("invalid_request", "metadata and a Markdown body are required.");
  }
  return { metadata, body: markdownBody };
};

const parsePhotography = async (request) => {
  if (!request.isMultipart()) throw badRequest("invalid_request", "Photography publication requires multipart form data.");
  let metadata;
  let total = 0;
  const uploads = new Map();
  for await (const part of request.parts()) {
    if (part.type === "field") {
      if (part.fieldname !== "metadata" || metadata) throw badRequest("invalid_request", "Unexpected or duplicate multipart field.");
      try { metadata = JSON.parse(part.value); } catch { throw badRequest("invalid_request", "Photography metadata is not valid JSON."); }
      continue;
    }
    const match = part.fieldname.match(/^(full|thumbnail)\.([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (!match || part.mimetype !== "image/webp") throw badRequest("invalid_image", "Only named full and thumbnail WebP pairs are accepted.");
    const [, kind, id] = match;
    const pair = uploads.get(id) ?? {};
    if (pair[kind]) throw badRequest("invalid_image", "Duplicate photography upload path.");
    const buffer = await part.toBuffer();
    total += buffer.length;
    if (total > 28 * 1024 * 1024) throw badRequest("image_too_large", "Photography upload exceeds 28 MiB.");
    pair[kind] = buffer;
    uploads.set(id, pair);
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw badRequest("invalid_request", "Photography metadata is required.");
  for (const [id, pair] of uploads) {
    if (!pair.full || !pair.thumbnail) throw badRequest("invalid_image", `Image ${id} requires a full and thumbnail pair.`);
  }
  return { metadata, body: "", uploads };
};

export const buildServer = async ({
  environment = process.env,
  fetchImpl = fetch,
  githubClient,
  sessionManager,
  logger = false,
  now,
} = {}) => {
  const config = loadConfig(environment);
  const app = Fastify({
    logger: logger ? {
      redact: ["req.headers", "req.query", "req.body", "res.headers"],
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: String(request.url ?? "").split("?", 1)[0],
            remoteAddress: request.ip,
          };
        },
      },
    } : false,
    bodyLimit: 300 * 1024,
    genReqId: () => crypto.randomUUID(),
  });
  const sessions = sessionManager ?? createSessionManager(config, { ...(now ? { now } : {}) });
  const github = githubClient ?? createGitHubClient(config, { fetchImpl, ...(now ? { now } : {}) });
  const repository = createRepositoryService(github);
  const cookieName = config.nodeEnv === "production" ? OAUTH_COOKIE : DEV_OAUTH_COOKIE;
  const sendCallback = (reply, payload, statusCode = 200) => {
    const nonce = sessions.randomToken(18);
    reply.header("Content-Security-Policy", `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
    reply.header("X-Frame-Options", "DENY");
    return reply.code(statusCode).type("text/html; charset=utf-8").send(callbackPage({ origin: config.siteOrigin, nonce, ...payload }));
  };

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
  await app.register(cors, {
    credentials: false,
    origin(origin, callback) {
      callback(null, !origin || config.allowedOrigins.includes(origin));
    },
    allowedHeaders: ["Authorization", "Content-Type", "If-Match", "If-None-Match"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposedHeaders: ["ETag"],
  });
  await app.register(multipart, {
    limits: { files: 24, fields: 1, parts: 25, fileSize: 2 * 1024 * 1024 },
    throwFileSizeLimit: true,
  });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error, request, reply) => jsonError(request, reply, error));
  app.setNotFoundHandler((request, reply) => jsonError(request, reply, new AppError(404, "not_found", "The requested route does not exist.")));

  app.get("/healthz", async () => ({ status: "ok", configured: config.configured }));

  app.get("/auth/github/start", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    requireConfigured(config);
    noStore(reply);
    const channel = String(request.query?.channel ?? "");
    if (!CHANNEL_PATTERN.test(channel)) throw badRequest("invalid_channel", "The authentication channel is invalid.");
    const state = `${sessions.randomToken()}.${channel}`;
    const verifier = sessions.randomToken(48);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const sealed = await sessions.sealOAuth({ state, verifier, channel });
    reply.header("Set-Cookie", oauthCookie(cookieName, sealed, { secure: config.nodeEnv === "production" }));
    const authorization = new URL("https://github.com/login/oauth/authorize");
    authorization.searchParams.set("client_id", config.githubClientId);
    authorization.searchParams.set("redirect_uri", config.callbackUrl);
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");
    return reply.redirect(authorization.href);
  });

  app.get("/auth/github/callback", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    requireConfigured(config);
    noStore(reply);
    const hintedChannel = String(request.query?.state ?? "").split(".").at(-1);
    const sealed = readCookie(request, cookieName);
    reply.header("Set-Cookie", oauthCookie(cookieName, "", { secure: config.nodeEnv === "production", clear: true }));
    let oauth;
    let userToken;
    try {
      if (!sealed) throw unauthorized("The GitHub authorization state is missing or expired.");
      oauth = await sessions.openOAuth(sealed);
      if (!request.query?.state || request.query.state !== oauth.state || !request.query?.code) {
        throw unauthorized("The GitHub authorization state is invalid or expired.");
      }
      const exchanged = await github.exchangeOAuthCode({ code: request.query.code, verifier: oauth.verifier });
      userToken = exchanged?.access_token;
      if (!userToken) throw unauthorized("GitHub did not return a usable authorization result.");
      const user = await github.getUser(userToken);
      if (String(user?.id) !== config.allowedGithubUserId || String(user?.login ?? "").toLowerCase() !== config.allowedGithubLogin) {
        throw forbidden();
      }
      const session = await sessions.issue(user);
      return sendCallback(reply, {
        channel: oauth.channel,
        token: session.token,
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      const safe = error instanceof AppError ? error : new AppError(502, "github_error", "GitHub authorization could not be completed.");
      const channel = oauth?.channel ?? (CHANNEL_PATTERN.test(hintedChannel) ? hintedChannel : "");
      return sendCallback(reply, { channel, error: safe.message }, safe.statusCode);
    } finally {
      if (userToken) await github.revokeUserToken(userToken).catch(() => {});
    }
  });

  const authenticate = async (request, reply) => {
    noStore(reply);
    request.cmsSession = await sessions.verify(parseBearer(request.headers.authorization));
  };
  const mutationOrigin = async (request) => {
    if (!config.allowedOrigins.includes(request.headers.origin)) throw forbidden("This mutation origin is not allowed.");
  };

  const readOptions = { preHandler: authenticate, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };
  app.get("/api/session", readOptions, async (request) => ({
    owner: { id: request.cmsSession.sub, login: request.cmsSession.login },
    expiresAt: request.cmsSession.exp,
  }));
  app.post("/api/logout", { preHandler: [authenticate, mutationOrigin] }, async (request, reply) => {
    sessions.revoke(request.cmsSession);
    return reply.code(204).send();
  });
  app.get("/api/content/:collection", readOptions, async (request) => repository.list(assertCollection(request.params.collection)));
  app.get("/api/content/:collection/:slug", readOptions, async (request, reply) => {
    const result = await repository.get(assertCollection(request.params.collection), request.params.slug);
    reply.header("ETag", `"${result.version}"`);
    return result;
  });

  const mutationOptions = { preHandler: [authenticate, mutationOrigin], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };
  app.post("/api/content/:collection", mutationOptions, async (request, reply) => {
    const collection = assertCollection(request.params.collection);
    const payload = collection === "photography" ? await parsePhotography(request) : parseJsonPayload(request);
    const slug = payload.metadata?.slug;
    const result = await repository.publish({ action: "create", collection, slug, ...payload, ifNoneMatch: request.headers["if-none-match"] });
    return reply.code(201).send(result);
  });
  app.put("/api/content/:collection/:slug", mutationOptions, async (request) => {
    const collection = assertCollection(request.params.collection);
    const payload = collection === "photography" ? await parsePhotography(request) : parseJsonPayload(request);
    if (payload.metadata?.slug && payload.metadata.slug !== request.params.slug) throw conflict("Published slugs are immutable.");
    return repository.publish({ action: "update", collection, slug: request.params.slug, ...payload, ifMatch: request.headers["if-match"] });
  });
  app.delete("/api/content/:collection/:slug", mutationOptions, async (request) => repository.publish({
    action: "delete",
    collection: assertCollection(request.params.collection),
    slug: request.params.slug,
    ifMatch: request.headers["if-match"],
  }));
  app.post("/api/preview/:collection", mutationOptions, async (request) => {
    const collection = assertCollection(request.params.collection);
    const { metadata, body } = parseJsonPayload(request);
    const normalized = normalizeEntry(collection, metadata, body);
    return {
      metadata: normalized.metadata,
      blocks: collection === "photography" ? [] : markdownToAst(normalized.body),
    };
  });

  return app;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await buildServer({ logger: true });
  await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 3000) });
}
