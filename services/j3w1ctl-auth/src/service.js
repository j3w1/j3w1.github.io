import { createHash, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { handleUpload } from "@vercel/blob/client";
import { createBlobStore } from "./blob-store.js";
import { J3W1CTL_API_PROTOCOL } from "./constants.js";
import { assertCollection, normalizeEntry, markdownToAst } from "./content.js";
import { loadConfig, requireConfigured } from "./config.js";
import { AppError, badRequest, conflict, forbidden, unauthorized } from "./errors.js";
import { createGitHubClient } from "./github.js";
import { safeProvenance } from "./provenance.js";
import { createRepositoryService } from "./repository.js";
import { createSessionManager } from "./session.js";
import { createRedisStore } from "./store.js";
import { createUploadBatchManager } from "./upload-batches.js";

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

export const buildServer = async ({
  fastifyFactory = Fastify,
  environment = process.env,
  fetchImpl = fetch,
  githubClient,
  sessionManager,
  sharedStore,
  blobStore,
  repositoryService,
  uploadBatchManager,
  logger = false,
  now,
} = {}) => {
  const config = loadConfig(environment);
  const app = fastifyFactory({
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
  const store = sharedStore ?? createRedisStore(config);
  const sessions = sessionManager ?? createSessionManager(config, { store, ...(now ? { now } : {}) });
  const github = githubClient ?? createGitHubClient(config, { fetchImpl, ...(now ? { now } : {}) });
  const repository = repositoryService ?? createRepositoryService(github);
  const privateBlobs = blobStore ?? createBlobStore(config);
  const batches = uploadBatchManager ?? createUploadBatchManager({ store, blobStore: privateBlobs, repository, ...(now ? { now } : {}) });
  const provenance = safeProvenance(config);
  const cookieName = config.nodeEnv === "production" ? OAUTH_COOKIE : DEV_OAUTH_COOKIE;
  const sendCallback = (reply, payload, statusCode = 200) => {
    const nonce = sessions.randomToken(18);
    reply.header("Content-Security-Policy", `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
    reply.header("X-Frame-Options", "DENY");
    return reply.code(statusCode).type("text/html; charset=utf-8").send(callbackPage({ origin: config.siteOrigin, nonce, ...payload }));
  };

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // The OAuth callback must retain the cross-origin Pages window as its opener
    // so it can deliver the channel-bound CMS session with postMessage.
    crossOriginOpenerPolicy: false,
  });
  await app.register(cors, {
    credentials: false,
    origin(origin, callback) {
      callback(null, !origin || config.allowedOrigins.includes(origin));
    },
    allowedHeaders: ["Authorization", "Content-Type", "If-Match", "If-None-Match", "X-Vercel-Blob-Request-Attempt"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposedHeaders: ["ETag"],
  });
  app.setErrorHandler((error, request, reply) => jsonError(request, reply, error));
  app.setNotFoundHandler((request, reply) => jsonError(request, reply, new AppError(404, "not_found", "The requested route does not exist.")));

  app.get("/healthz", async () => ({ status: "ok", configured: config.configured, protocolVersion: J3W1CTL_API_PROTOCOL, provenance }));

  app.get("/auth/github/start", async (request, reply) => {
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

  app.get("/auth/github/callback", async (request, reply) => {
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
    requireConfigured(config);
    noStore(reply);
    request.cmsToken = parseBearer(request.headers.authorization);
    request.cmsSession = await sessions.verify(request.cmsToken);
  };
  const mutationOrigin = async (request) => {
    if (!config.allowedOrigins.includes(request.headers.origin)) throw forbidden("This mutation origin is not allowed.");
  };

  const readOptions = { preHandler: authenticate };
  app.get("/api/session", readOptions, async (request) => ({
    owner: { id: request.cmsSession.sub, login: request.cmsSession.login },
    expiresAt: request.cmsSession.exp,
    protocolVersion: J3W1CTL_API_PROTOCOL,
    provenance,
    repository: provenance.repository,
  }));
  app.post("/api/logout", { preHandler: [authenticate, mutationOrigin] }, async (request, reply) => {
    await sessions.revoke(request.cmsToken);
    return reply.code(204).send();
  });
  app.get("/api/content/:collection", readOptions, async (request) => repository.list(assertCollection(request.params.collection)));
  app.get("/api/content/:collection/:slug", readOptions, async (request, reply) => {
    const result = await repository.get(assertCollection(request.params.collection), request.params.slug);
    reply.header("ETag", `"${result.version}"`);
    return result;
  });

  const mutationOptions = { preHandler: [authenticate, mutationOrigin] };
  app.post("/api/content/:collection", mutationOptions, async (request, reply) => {
    const collection = assertCollection(request.params.collection);
    if (collection === "photography") throw badRequest("upload_batch_required", "Photography publication requires a private upload batch.");
    const payload = parseJsonPayload(request);
    const slug = payload.metadata?.slug;
    const result = await repository.publish({ action: "create", collection, slug, ...payload, ifNoneMatch: request.headers["if-none-match"] });
    return reply.code(201).send(result);
  });
  app.put("/api/content/:collection/:slug", mutationOptions, async (request) => {
    const collection = assertCollection(request.params.collection);
    if (collection === "photography") throw badRequest("upload_batch_required", "Photography publication requires a private upload batch.");
    const payload = parseJsonPayload(request);
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

  app.post("/api/photography/upload-batches", mutationOptions, async (request, reply) => {
    const result = await batches.create({
      session: request.cmsSession,
      body: request.body,
      ifMatch: request.headers["if-match"],
      ifNoneMatch: request.headers["if-none-match"],
    });
    return reply.code(201).send(result);
  });

  app.post("/api/photography/upload-batches/:id/upload", async (request) => {
    requireConfigured(config);
    if (request.body?.type === "blob.generate-client-token") await mutationOrigin(request);
    return handleUpload({
      body: request.body,
      request: request.raw,
      token: config.blobToken,
      onBeforeGenerateToken: (pathname, clientPayload) => batches.authorizeUpload({ id: request.params.id, pathname, clientPayload }),
      onUploadCompleted: ({ blob, tokenPayload }) => batches.confirmUpload({ blob, tokenPayload }),
    });
  });

  app.post("/api/photography/upload-batches/:id/finalize", mutationOptions, async (request) => {
    if (!request.body?.metadata || typeof request.body.metadata !== "object" || Array.isArray(request.body.metadata)) {
      throw badRequest("invalid_request", "Photography metadata is required.");
    }
    return batches.finalize({
      id: request.params.id,
      session: request.cmsSession,
      metadata: request.body.metadata,
      verifySession: () => sessions.verify(request.cmsToken),
    });
  });

  app.post("/api/photography/upload-batches/:id/cancel", mutationOptions, async (request, reply) => {
    await batches.cancel({ id: request.params.id, session: request.cmsSession });
    return reply.code(204).send();
  });

  app.get("/api/internal/cleanup-staging", async (request) => {
    requireConfigured(config);
    const supplied = String(request.headers.authorization ?? "");
    const expected = `Bearer ${config.cronSecret}`;
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) throw unauthorized();
    return batches.cleanup();
  });

  return app;
};
