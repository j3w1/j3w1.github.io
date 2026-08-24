import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const origin = "http://127.0.0.1:8010";
const ast = (text) => [{ type: "paragraph", children: [{ type: "text", value: text }] }];
const collections = {
  writing: [{ title: "Browser fixture essay", slug: "fixture-essay", date: "2026-08-24", summary: "Safe AST browser fixture.", tags: ["test"], blocks: ast("Rendered from the same restricted AST."), contentDigest: "fixture" }],
  books: [{ title: "Fixture Book", slug: "fixture-book", author: "Test Author", year: 2026, status: "reading", tags: ["test"], notes: ast("Private reading notes are not used here."), contentDigest: "fixture" }],
  photography: [{ title: "Fixture Photographs", slug: "fixture-photographs", date: "2026-08-24", caption: "Browser-only fixture.", location: "Local test", images: [{ id: "image-01", file: "image-01.webp", thumbnail: "image-01-thumb.webp", alt: "One-pixel browser test image", src: "/fixture.webp", thumbnailSrc: "/fixture.webp" }], contentDigest: "fixture" }],
};
const index = { schemaVersion: 1, collections };
const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/v89WAAAAA==", "base64");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".ttf": "font/ttf" };

const json = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};

createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  if (url.pathname === "/admin/config.js") {
    response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    return response.end(`window.J3W1CTL_CONFIG=Object.freeze({apiBaseUrl:${JSON.stringify(origin)}});`);
  }
  if (url.pathname === "/auth/github/start") {
    const channel = url.searchParams.get("channel") ?? "";
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    return response.end(`<script>opener.postMessage({type:'j3w1ctl:auth-success',channel:${JSON.stringify(channel)},token:'browser-fixture-token',expiresAt:9999999999},${JSON.stringify(origin)});close()</script>`);
  }
  if (url.pathname === "/assets/data/content-index.json") return json(response, 200, index);
  if (url.pathname === "/fixture.webp") { response.writeHead(200, { "Content-Type": "image/webp", "Cache-Control": "no-store" }); return response.end(webp); }
  if (url.pathname === "/api/session") return json(response, 200, { owner: { id: "42", login: "j3w1" }, expiresAt: 9999999999 });
  if (url.pathname.match(/^\/api\/content\/(writing|books|photography)$/) && request.method === "GET") {
    const collection = url.pathname.split("/").at(-1);
    return json(response, 200, { collection, entries: collections[collection], headSha: "2".repeat(40) });
  }
  const detail = url.pathname.match(/^\/api\/content\/(writing|books|photography)\/([^/]+)$/);
  if (detail && request.method === "GET") {
    const entry = collections[detail[1]].find(({ slug }) => slug === detail[2]);
    return entry ? json(response, 200, { entry, body: detail[1] === "writing" ? "Rendered from the same restricted AST." : "Private reading notes are not used here.", version: "1".repeat(40), headSha: "2".repeat(40) }) : json(response, 404, { error: { code: "not_found", message: "Missing fixture.", requestId: "fixture" } });
  }
  const preview = url.pathname.match(/^\/api\/preview\/(writing|books|photography)$/);
  if (preview && request.method === "POST") {
    let body = ""; for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body);
    return json(response, 200, { metadata: parsed.metadata, blocks: ast(parsed.body || parsed.metadata.caption || "Photography preview metadata is valid.") });
  }
  if (url.pathname === "/api/logout" && request.method === "POST") { response.writeHead(204); return response.end(); }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  const resolved = path.resolve(root, `.${pathname}`);
  if (!resolved.startsWith(`${root}${path.sep}`)) return json(response, 404, { error: { code: "not_found", message: "Not found.", requestId: "fixture" } });
  try {
    const content = await fs.readFile(resolved);
    response.writeHead(200, { "Content-Type": mime[path.extname(resolved)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(content);
  } catch { json(response, 404, { error: { code: "not_found", message: "Not found.", requestId: "fixture" } }); }
}).listen(8010, "127.0.0.1", () => console.log(`Browser fixture listening on ${origin}`));

