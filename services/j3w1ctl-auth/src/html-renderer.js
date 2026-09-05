/* Renders the restricted content AST to an HTML string.

   This mirrors assets/js/content-renderer.js — the same element table, the
   same rejections, the same rel rule — and serialises exactly the way a
   browser's innerHTML would, so a Playwright test can hold the two to
   byte-for-byte parity. It exists because the prerendered entry pages must
   contain the real content as HTML for crawlers and link previews, and the
   browser renderer cannot run without a DOM. */

const ELEMENTS = Object.freeze({
  paragraph: "p",
  blockquote: "blockquote",
  listItem: "li",
  emphasis: "em",
  strong: "strong",
  code: "code",
});

export const escapeText = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll(" ", "&nbsp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const escapeAttribute = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll(" ", "&nbsp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const renderChildren = (children, origin) => (children ?? []).map((child) => renderNode(child, origin)).join("");

const renderNode = (node, origin) => {
  if (!node || typeof node !== "object") throw new TypeError("Invalid content node");
  if (node.type === "text") return escapeText(node.value ?? "");
  if (node.type === "break") return "<br>";
  if (node.type === "heading") {
    const level = Number(node.level);
    if (!Number.isInteger(level) || level < 1 || level > 6) throw new TypeError("Invalid heading");
    return `<h${level}>${renderChildren(node.children, origin)}</h${level}>`;
  }
  if (node.type === "list") {
    const tag = node.ordered ? "ol" : "ul";
    const start = node.ordered && Number.isInteger(node.start) ? ` start="${node.start}"` : "";
    return `<${tag}${start}>${renderChildren(node.children, origin)}</${tag}>`;
  }
  if (node.type === "link") {
    const href = String(node.href ?? "");
    const url = new URL(href, origin);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) throw new TypeError("Unsafe link");
    const rel = url.origin !== origin && url.protocol !== "mailto:" ? ' rel="noopener noreferrer"' : "";
    return `<a href="${escapeAttribute(href)}"${rel}>${renderChildren(node.children, origin)}</a>`;
  }
  if (node.type === "codeBlock") {
    const language = node.language ? ` data-language="${escapeAttribute(node.language)}"` : "";
    return `<pre><code${language}>${escapeText(node.value ?? "")}</code></pre>`;
  }
  const tag = ELEMENTS[node.type];
  if (!tag) throw new TypeError(`Unsupported content node: ${node.type}`);
  if (node.type === "code") return `<code>${escapeText(node.value ?? "")}</code>`;
  return `<${tag}>${renderChildren(node.children, origin)}</${tag}>`;
};

export const renderAstHtml = (nodes, { origin }) => {
  if (!Array.isArray(nodes)) throw new TypeError("Invalid AST");
  if (!origin) throw new TypeError("An origin is required to classify links");
  return nodes.map((node) => renderNode(node, origin)).join("");
};
