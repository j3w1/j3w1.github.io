/* The modulepreload list for index.html, derived from the static import graph.

   Without it the browser discovers the window manager's modules by parsing
   each one in turn — four round trips before the desktop can boot. Every
   module reachable by a *static* import from the two entry scripts is listed
   here so they all start downloading with the HTML; dynamic imports (the
   greeter, touch, the lazily loaded applications) are deliberately absent. */

import { promises as fs } from "node:fs";
import path from "node:path";

const ENTRIES = ["assets/js/site.js", "assets/js/public-content.js"];
const START = "<!-- @generated-preloads:start -->";
const END = "<!-- @generated-preloads:end -->";
const STATIC_IMPORT = /^import\s[^;]*?from\s+"([^"]+)";|^import\s+"([^"]+)";/gm;

/* Returns the sorted list of site-absolute specifiers ("/assets/js/…?v=…")
   reachable from the entry scripts. The entries themselves are excluded: they
   are already fetched by their <script type="module"> tags. */
export const collectStaticGraph = async (repoRoot) => {
  const seen = new Map();
  const queue = ENTRIES.map((relative) => `/${relative}`);
  while (queue.length) {
    const specifier = queue.shift();
    const [pathname, query] = specifier.split("?");
    if (seen.has(pathname)) continue;
    seen.set(pathname, query ? `${pathname}?${query}` : pathname);
    const source = await fs.readFile(path.join(repoRoot, pathname.slice(1)), "utf8");
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const target = match[1] ?? match[2];
      if (!target || /^https?:/.test(target)) continue;
      const [targetPath, targetQuery] = target.split("?");
      const resolved = targetPath.startsWith("/")
        ? targetPath
        : path.posix.normalize(path.posix.join(path.posix.dirname(pathname), targetPath));
      queue.push(targetQuery ? `${resolved}?${targetQuery}` : resolved);
    }
  }
  const entries = new Set(ENTRIES.map((relative) => `/${relative}`));
  return [...seen.entries()].filter(([pathname]) => !entries.has(pathname)).map(([, specifier]) => specifier).sort();
};

export const applyPreloads = async (repoRoot, specifiers, { check = false } = {}) => {
  const file = path.join(repoRoot, "index.html");
  const html = (await fs.readFile(file, "utf8")).replaceAll("\r\n", "\n");
  const start = html.indexOf(START);
  const end = html.indexOf(END);
  if (start < 0 || end < 0) throw new Error(`index.html must contain the ${START} … ${END} markers`);
  const block = [START, ...specifiers.map((href) => `<link rel="modulepreload" href="${href}">`), END].join("\n  ");
  const next = html.slice(0, start) + block + html.slice(end + END.length);
  if (next === html) return [];
  if (!check) await fs.writeFile(file, next);
  return ["index.html"];
};

export const preloadsGenerator = {
  name: "modulepreload list",
  async run({ repoRoot, check }) {
    const graph = await collectStaticGraph(repoRoot);
    const stale = await applyPreloads(repoRoot, graph, { check });
    if (check && stale.length) throw new Error("index.html's modulepreload list is stale — run npm run generate");
    return `${graph.length} modules${stale.length ? " (index.html written)" : ""}`;
  },
};
