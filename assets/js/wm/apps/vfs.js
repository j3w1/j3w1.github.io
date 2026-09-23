/* The terminal's virtual filesystem: the site projected as paths. The content
   index supplies writing, books and photography; the project table, the link
   list, the about buffers and the home terminal's whoami and README are read
   from the page, which content/site.json generates, so the shell never keeps
   a copy of any of them; the original machine's dotfiles are fetched the
   first time one is read. */

import { loadContentIndex } from "../../content-index.js?v=20260923";

/* whoami and README are the home terminal's authored output, generated from
   content/site.json; the shell reads them from the page rather than carrying
   a copy. Captured on the first command, before `clear` can remove them. */
let identity = null;
export const readIdentity = () => {
  identity ??= {
    whoami: [...document.querySelectorAll("[data-site-whoami] p")].map((line) => line.textContent.trim()),
    readme: [...document.querySelectorAll("[data-site-readme] p")].map((line) => line.textContent.trim()),
  };
  return identity;
};

const readProjects = () =>
  [...document.querySelectorAll("[data-project-row]")].map((row) => ({
    slug: row.dataset.projectRow,
    name: row.cells[1]?.textContent.trim() ?? row.dataset.projectRow,
    stack: row.cells[2]?.textContent.trim() ?? "",
    state: row.cells[3]?.textContent.trim() ?? "",
    repository: row.cells[4]?.textContent.trim() ?? "",
  }));

const readLinks = () =>
  [...document.querySelectorAll(".link-list li")].map((item) => ({
    name: item.querySelector("a")?.textContent.trim() ?? "link",
    href: item.querySelector("a")?.getAttribute("href") ?? "",
  }));

/* The original machine's dotfiles, trimmed, served as plain files and fetched
   the first time one is read. */
const DOTFILES = {
  ".Xresources": "Xresources",
  ".dmenurc": "dmenurc",
  ".config/i3/config": "i3-config",
  ".config/i3/i3status.conf": "i3status.conf",
  ".config/dunst/dunstrc": "dunstrc",
  ".screenlayout/j3w1-obsidian.sh": "screenlayout.sh",
};
const dotfileCache = new Map();
export const readDotfile = async (name) => {
  if (!dotfileCache.has(name)) {
    dotfileCache.set(name, fetch(`/assets/data/dotfiles/${name}`).then((response) => (response.ok ? response.text() : null)).catch(() => null));
  }
  return dotfileCache.get(name);
};

const dotfileTree = () => {
  const root = {};
  for (const [path, file] of Object.entries(DOTFILES)) {
    const parts = path.split("/");
    let node = root;
    parts.slice(0, -1).forEach((segment) => {
      node[`${segment}/`] ??= { kind: "dir", children: {} };
      node = node[`${segment}/`].children;
    });
    node[parts.at(-1)] = { kind: "dotfile", file, path: `~/${path}` };
  }
  return root;
};

/* The tree is rebuilt on demand so published content appears without a reload. */
export const buildTree = async () => {
  const index = await loadContentIndex();
  const collection = (name) => index?.collections?.[name] ?? [];
  const entries = (name) =>
    Object.fromEntries(collection(name).map((entry) => [`${entry.slug}.md`, { kind: name, entry }]));

  return {
    README: { kind: "text", lines: readIdentity().readme },
    "about/": {
      kind: "dir",
      children: {
        "about.md": { kind: "dom", selector: "[data-wm-window='about-editor'] .vim-buffer" },
        "interests.md": { kind: "dom", selector: "[data-wm-window='about-interests'] .vim-buffer" },
      },
    },
    "writing/": { kind: "dir", children: entries("writing") },
    "books/": { kind: "dir", children: entries("books") },
    "photography/": {
      kind: "dir",
      children: Object.fromEntries(
        collection("photography").map((entry) => [`${entry.slug}/`, { kind: "photos", entry }]),
      ),
    },
    "projects/": {
      kind: "dir",
      children: Object.fromEntries(
        readProjects().map((project) => [`${project.slug}.md`, { kind: "project", project }]),
      ),
    },
    "elsewhere/": {
      kind: "dir",
      children: Object.fromEntries(readLinks().map((link) => [link.name, { kind: "link", link }])),
    },
    ...dotfileTree(),
  };
};

export const WORKSPACE_FOR_DIR = {
  "writing/": "writing",
  "books/": "books",
  "photography/": "photography",
  "projects/": "projects",
  "elsewhere/": "elsewhere",
  "about/": "about",
};
