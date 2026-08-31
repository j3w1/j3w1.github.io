import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const frontendOrigin = "http://127.0.0.1:8010";
const authOrigin = "http://127.0.0.1:8011";
const ast = (text) => [{ type: "paragraph", children: [{ type: "text", value: text }] }];
const collections = {
  writing: [{ title: "Browser fixture essay", slug: "fixture-essay", date: "2026-08-24", summary: "Safe AST browser fixture.", tags: ["test"], blocks: ast("Rendered from the same restricted AST."), contentDigest: "fixture" }],
  books: [{ title: "Fixture Book", slug: "fixture-book", author: "Test Author", year: 2026, status: "reading", tags: ["test"], notes: ast("Private reading notes are not used here."), contentDigest: "fixture" }],
  photography: [{ title: "Fixture Photographs", slug: "fixture-photographs", date: "2026-08-24", caption: "Browser-only fixture.", location: "Local test", camera: "Fixture camera", images: [{ id: "image-01", file: "image-01.webp", thumbnail: "image-01-thumb.webp", alt: "First browser test image", caption: "First fixture photograph", src: "/fixture.webp", thumbnailSrc: "/fixture.webp" }, { id: "image-02", file: "image-02.webp", thumbnail: "image-02-thumb.webp", alt: "Second browser test image", caption: "Second fixture photograph", src: "/fixture.webp", thumbnailSrc: "/fixture.webp" }], contentDigest: "fixture" }],
};
const index = { schemaVersion: 1, collections };
const fixtureState = {
  post: 0,
  put: 0,
  delete: 0,
  failNext: 0,
  failNextRead: 0,
  readDelay: 0,
  collectionGets: { writing: 0, books: 0, photography: 0 },
  detailGets: { writing: 0, books: 0, photography: 0 },
  previewPosts: { writing: 0, books: 0, photography: 0 },
  protocolVersion: 1,
  validSession: false,
  uploadNames: [],
};
const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/v89WAAAAA==", "base64");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".ttf": "font/ttf" };

const json = (response, status, body, headers = {}) => {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(body));
};
const corsHeaders = {
  "Access-Control-Allow-Origin": frontendOrigin,
  "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match, If-None-Match",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  Vary: "Origin",
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const frontendServer = createServer(async (request, response) => {
  const url = new URL(request.url, frontendOrigin);
  if (url.pathname === "/admin/config.js") {
    response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    return response.end(`window.J3W1CTL_CONFIG=Object.freeze({apiBaseUrl:${JSON.stringify(authOrigin)}});`);
  }
  if (url.pathname === "/assets/data/content-index.json") return json(response, 200, index);
  if (url.pathname === "/fixture.webp") { response.writeHead(200, { "Content-Type": "image/webp", "Cache-Control": "no-store" }); return response.end(webp); }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  const resolved = path.resolve(root, `.${pathname}`);
  if (!resolved.startsWith(`${root}${path.sep}`)) return json(response, 404, { error: { code: "not_found", message: "Not found.", requestId: "fixture" } });
  try {
    const content = await fs.readFile(resolved);
    response.writeHead(200, { "Content-Type": mime[path.extname(resolved)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(content);
  } catch { json(response, 404, { error: { code: "not_found", message: "Not found.", requestId: "fixture" } }); }
});

const authServer = createServer(async (request, response) => {
  const url = new URL(request.url, authOrigin);
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    return response.end();
  }
  if (url.pathname === "/auth/github/start") {
    const channel = url.searchParams.get("channel") ?? "";
    response.writeHead(302, {
      "Cache-Control": "no-store",
      Location: `${authOrigin}/auth/github/callback?channel=${encodeURIComponent(channel)}`,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    });
    return response.end();
  }
  if (url.pathname === "/auth/github/callback") {
    const channel = url.searchParams.get("channel") ?? "";
    const nonce = "browser-fixture-nonce";
    fixtureState.validSession = true;
    const payload = { type: "j3w1ctl:auth-success", channel, token: "browser-fixture-token", expiresAt: 9999999999 };
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    return response.end(`<!doctype html><title>fixture callback</title><script nonce="${nonce}">(()=>{const payload=${JSON.stringify(payload)};if(window.opener&&!window.opener.closed)window.opener.postMessage(payload,${JSON.stringify(frontendOrigin)});window.close()})()</script>`);
  }
  if (url.pathname === "/__test/state") return json(response, 200, fixtureState, corsHeaders);
  if (url.pathname === "/__test/fail-next" && request.method === "POST") { fixtureState.failNext = Number(url.searchParams.get("status") || 500); return json(response, 200, fixtureState, corsHeaders); }
  if (url.pathname === "/__test/fail-next-read" && request.method === "POST") { fixtureState.failNextRead = Number(url.searchParams.get("status") || 500); return json(response, 200, fixtureState, corsHeaders); }
  if (url.pathname === "/__test/read-delay" && request.method === "POST") { fixtureState.readDelay = Math.min(2000, Math.max(0, Number(url.searchParams.get("ms")) || 0)); return json(response, 200, fixtureState, corsHeaders); }
  if (url.pathname === "/__test/protocol" && request.method === "POST") { fixtureState.protocolVersion = url.searchParams.has("value") ? Number(url.searchParams.get("value")) : undefined; return json(response, 200, fixtureState, corsHeaders); }
  if (url.pathname === "/__test/reset" && request.method === "POST") { Object.assign(fixtureState, { post: 0, put: 0, delete: 0, failNext: 0, failNextRead: 0, readDelay: 0, collectionGets: { writing: 0, books: 0, photography: 0 }, detailGets: { writing: 0, books: 0, photography: 0 }, previewPosts: { writing: 0, books: 0, photography: 0 }, protocolVersion: 1, validSession: false, uploadNames: [] }); return json(response, 200, fixtureState, corsHeaders); }
  const provenance = { provider: "vercel", runtime: "node", environment: "development", sourceRevision: "179a3740656b16a0382f362917651ee829643aea", protocolVersion: fixtureState.protocolVersion, repository: { owner: "j3w1", name: "j3w1.github.io", branch: "main" } };
  if (url.pathname === "/healthz") return json(response, 200, { status: "ok", configured: true, protocolVersion: fixtureState.protocolVersion, provenance }, corsHeaders);
  if (url.pathname.startsWith("/api/") && request.headers.authorization !== "Bearer browser-fixture-token") return json(response, 401, { error: { code: "unauthorized", message: "Authentication required.", requestId: "fixture" } }, corsHeaders);
  if (url.pathname !== "/api/logout" && url.pathname.startsWith("/api/") && !fixtureState.validSession) return json(response, 401, { error: { code: "unauthorized", message: "Authentication required.", requestId: "fixture" } }, corsHeaders);
  if (url.pathname === "/api/session") return json(response, 200, { owner: { id: "42", login: "j3w1" }, expiresAt: 9999999999, protocolVersion: fixtureState.protocolVersion, provenance, repository: { owner: "j3w1", name: "j3w1.github.io", branch: "main" } }, corsHeaders);
  if (url.pathname.match(/^\/api\/content\/(writing|books|photography)$/) && request.method === "GET") {
    const collection = url.pathname.split("/").at(-1);
    fixtureState.collectionGets[collection] += 1;
    await wait(fixtureState.readDelay);
    if (fixtureState.failNextRead) { const status = fixtureState.failNextRead; fixtureState.failNextRead = 0; return json(response, status, { error: { code: "fixture_read_error", message: "Fixture read failed.", requestId: "fixture" } }, corsHeaders); }
    return json(response, 200, { collection, entries: collections[collection], headSha: "2".repeat(40) }, corsHeaders);
  }
  const detail = url.pathname.match(/^\/api\/content\/(writing|books|photography)\/([^/]+)$/);
  if (detail && request.method === "GET") {
    fixtureState.detailGets[detail[1]] += 1;
    await wait(fixtureState.readDelay);
    if (fixtureState.failNextRead) { const status = fixtureState.failNextRead; fixtureState.failNextRead = 0; return json(response, status, { error: { code: "fixture_read_error", message: "Fixture read failed.", requestId: "fixture" } }, corsHeaders); }
    const entry = collections[detail[1]].find(({ slug }) => slug === detail[2]);
    return entry ? json(response, 200, { entry, body: detail[1] === "writing" ? "Rendered from the same restricted AST." : "Private reading notes are not used here.", version: "1".repeat(40), headSha: "2".repeat(40) }, corsHeaders) : json(response, 404, { error: { code: "not_found", message: "Missing fixture.", requestId: "fixture" } }, corsHeaders);
  }
  const mutation = url.pathname.match(/^\/api\/content\/(writing|books|photography)(?:\/([^/]+))?$/);
  if (mutation && ["POST", "PUT", "DELETE"].includes(request.method)) {
    const [, collection, routeSlug] = mutation;
    fixtureState[request.method.toLowerCase()] += 1;
    await wait(650);
    if (fixtureState.failNext) {
      const status = fixtureState.failNext; fixtureState.failNext = 0;
      return json(response, status, { error: { code: status === 409 ? "content_conflict" : "fixture_error", message: status === 409 ? "Remote content changed." : "Fixture mutation failed.", requestId: "fixture" } }, corsHeaders);
    }
    if (request.method === "DELETE") {
      const index = collections[collection].findIndex(({ slug }) => slug === routeSlug);
      if (index >= 0) collections[collection].splice(index, 1);
    } else if (request.headers["content-type"]?.startsWith("application/json")) {
      let body = ""; for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body); const metadata = parsed.metadata;
      const entry = { ...metadata, ...(collection === "writing" ? { blocks: ast(parsed.body) } : collection === "books" ? { notes: ast(parsed.body) } : {}), contentDigest: "mutation-fixture" };
      const index = collections[collection].findIndex(({ slug }) => slug === (routeSlug || metadata.slug));
      if (index >= 0) collections[collection][index] = entry; else collections[collection].push(entry);
    }
    return json(response, request.method === "POST" ? 201 : 200, { commitSha: "3".repeat(40), headSha: "3".repeat(40) }, corsHeaders);
  }
  const preview = url.pathname.match(/^\/api\/preview\/(writing|books|photography)$/);
  if (preview && request.method === "POST") {
    fixtureState.previewPosts[preview[1]] += 1;
    let body = ""; for await (const chunk of request) body += chunk;
    await wait(fixtureState.readDelay);
    if (fixtureState.failNextRead) { const status = fixtureState.failNextRead; fixtureState.failNextRead = 0; return json(response, status, { error: { code: "fixture_read_error", message: "Fixture preview failed.", requestId: "fixture" } }, corsHeaders); }
    const parsed = JSON.parse(body);
    return json(response, 200, { metadata: parsed.metadata, blocks: ast(parsed.body || parsed.metadata.caption || "Photography preview metadata is valid.") }, corsHeaders);
  }
  if (url.pathname === "/api/logout" && request.method === "POST") { fixtureState.validSession = false; response.writeHead(204, corsHeaders); return response.end(); }
  return json(response, 404, { error: { code: "not_found", message: "Not found.", requestId: "fixture" } }, corsHeaders);
});

const listen = (server, port) => new Promise((resolve, reject) => {
  const onError = (error) => reject(error);
  server.once("error", onError);
  server.listen(port, "127.0.0.1", () => {
    server.off("error", onError);
    resolve();
  });
});
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

export const startBrowserFixture = async () => {
  await listen(frontendServer, 8010);
  try {
    await listen(authServer, 8011);
  } catch (error) {
    await close(frontendServer);
    throw error;
  }
  return {
    frontendOrigin,
    authOrigin,
    close: () => Promise.all([close(frontendServer), close(authServer)]),
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startBrowserFixture();
  console.log(`Browser fixture frontend listening on ${frontendOrigin}`);
  console.log(`Browser fixture auth API listening on ${authOrigin}`);
}
