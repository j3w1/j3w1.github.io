const ELEMENTS = Object.freeze({
  paragraph: "p",
  blockquote: "blockquote",
  listItem: "li",
  emphasis: "em",
  strong: "strong",
  code: "code",
});

const renderNode = (node) => {
  if (!node || typeof node !== "object") throw new TypeError("Invalid content node");
  if (node.type === "text") return document.createTextNode(String(node.value ?? ""));
  if (node.type === "break") return document.createElement("br");
  if (node.type === "heading") {
    const level = Number(node.level);
    if (!Number.isInteger(level) || level < 1 || level > 6) throw new TypeError("Invalid heading");
    const heading = document.createElement(`h${level}`);
    for (const child of node.children ?? []) heading.append(renderNode(child));
    return heading;
  }
  if (node.type === "list") {
    const list = document.createElement(node.ordered ? "ol" : "ul");
    if (node.ordered && Number.isInteger(node.start)) list.start = node.start;
    for (const child of node.children ?? []) list.append(renderNode(child));
    return list;
  }
  if (node.type === "link") {
    const link = document.createElement("a");
    const href = String(node.href ?? "");
    const url = new URL(href, window.location.origin);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) throw new TypeError("Unsafe link");
    link.href = href;
    if (url.origin !== window.location.origin && url.protocol !== "mailto:") link.rel = "noopener noreferrer";
    for (const child of node.children ?? []) link.append(renderNode(child));
    return link;
  }
  if (node.type === "codeBlock") {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = String(node.value ?? "");
    if (node.language) code.dataset.language = String(node.language);
    pre.append(code);
    return pre;
  }
  const tag = ELEMENTS[node.type];
  if (!tag) throw new TypeError(`Unsupported content node: ${node.type}`);
  const element = document.createElement(tag);
  if (node.type === "code") element.textContent = String(node.value ?? "");
  else for (const child of node.children ?? []) element.append(renderNode(child));
  return element;
};

export const renderAst = (nodes, container) => {
  if (!Array.isArray(nodes) || !(container instanceof Element)) throw new TypeError("Invalid AST target");
  const fragment = document.createDocumentFragment();
  for (const node of nodes) fragment.append(renderNode(node));
  container.replaceChildren(fragment);
  return container;
};

