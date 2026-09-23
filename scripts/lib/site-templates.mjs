/* The markup the site generator writes into index.html, wiki/index.html and
   404.html from content/site.json. Every value passes through the same
   escapers the entry pages use; the only markup a data string may carry is
   the [label](href) link syntax in the about paragraphs.

   Templates return lines indented as they sit in their page, so a generated
   block reads like the hand-written markup around it. */

import { escapeAttribute as attr, escapeText as text } from "../../services/j3w1ctl-auth/src/html-renderer.js";
import { renderPageBar, renderPageFoot, renderSharedHead } from "../../services/j3w1ctl-auth/src/site-pages.js";

const WINDOW_MARKS = '<span class="window-marks" aria-hidden="true">─ □ ×</span>';
const HOME = "/home/j3w1";
const USER_AT_HOST = "j3w1@manjaro";

/* The file manager's folder rows, one per workspace; the three Git-managed
   collections report their counts at runtime from the content index. */
const FOLDERS = [
  { workspace: "home", icon: "&#xf07b;", type: "Workspace", state: "open" },
  { workspace: "writing", icon: "&#xf044;", type: "Vim buffer", count: "content" },
  { workspace: "projects", icon: "&#xf0ae;", type: "Application", count: "projects" },
  { workspace: "photography", icon: "&#xf030;", type: "Directory", count: "content" },
  { workspace: "books", icon: "&#xf02d;", type: "Library", count: "content" },
  { workspace: "elsewhere", icon: "&#xf0ac;", type: "Links", count: "links" },
  { workspace: "about", icon: "&#xf129;", type: "Vim buffer", state: "readable" },
];

const LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const SAFE_HREF = /^(?:https:\/\/[^\s"<>]+|\/[^\s"<>]*)$/;

/* Text with [label](href) links; everything else is escaped text. */
export const richText = (value) => {
  let html = "";
  let last = 0;
  for (const match of value.matchAll(LINK_PATTERN)) {
    const [whole, label, href] = match;
    if (!SAFE_HREF.test(href)) throw new Error(`unsafe link target ${href}`);
    html += text(value.slice(last, match.index)) + `<a href="${attr(href)}">${text(label)}</a>`;
    last = match.index + whole.length;
  }
  return html + text(value.slice(last));
};

const plural = (count, noun) => {
  if (count === 1) return `${count} ${noun}`;
  return `${count} ${noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
};
const withoutScheme = (url) => url.replace(/^https:\/\//, "");
const jsonLd = (value) => JSON.stringify(value, null, 2).replaceAll("<", "\\u003c");

export const siteTitle = (site) => `${site.identity.alternateName} — ${site.identity.role}`;
export const socialImage = (site) => `${site.site.origin}${site.site.image}`;

export const meta = (site) => {
  const title = siteTitle(site);
  const description = site.identity.description;
  return [
    `  <title>${text(title)}</title>`,
    `  <meta name="description" content="${attr(description)}">`,
    `  <link rel="canonical" href="${attr(site.site.origin)}/">`,
    `  <meta property="og:site_name" content="${attr(site.site.name)}">`,
    `  <meta property="og:title" content="${attr(title)}">`,
    `  <meta property="og:description" content="${attr(description)}">`,
    `  <meta property="og:type" content="profile">`,
    `  <meta property="og:url" content="${attr(site.site.origin)}/">`,
    `  <meta property="og:image" content="${attr(socialImage(site))}">`,
    `  <meta property="og:image:width" content="1200">`,
    `  <meta property="og:image:height" content="630">`,
    `  <meta property="og:locale" content="en_US">`,
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="${attr(title)}">`,
    `  <meta name="twitter:description" content="${attr(description)}">`,
    `  <meta name="twitter:image" content="${attr(socialImage(site))}">`,
  ].join("\n");
};

export const headShared = () => renderSharedHead();

export const structuredData = (site) => {
  const origin = site.site.origin;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: site.site.name,
        url: `${origin}/`,
        inLanguage: "en",
        description: site.site.description,
        publisher: { "@id": `${origin}/#person` },
      },
      {
        "@type": "Person",
        "@id": `${origin}/#person`,
        name: site.identity.name,
        alternateName: site.identity.alternateName,
        url: `${origin}/`,
        image: socialImage(site),
        description: site.identity.description,
        jobTitle: site.identity.jobTitle,
        sameAs: site.identity.sameAs,
      },
    ],
  };
  const body = jsonLd(graph).split("\n").map((line) => `  ${line}`).join("\n");
  return `  <script type="application/ld+json">\n${body}\n  </script>`;
};

/* oh-my-zsh agnoster, as the home terminal draws it. */
const agnoster = (command) =>
  `<span class="shell-prompt agnoster"><span class="prompt-path">~</span><span class="prompt-mark" aria-hidden="true">&#xe0b0;</span><span class="prompt-space"> </span></span>${command}`;

export const homeTerminal = (site) => {
  const { identity, home } = site;
  return [
    `        <article class="window pane terminal-window is-focused" data-wm-window="home-terminal" data-wm-title="${attr(USER_AT_HOST)}: ~" tabindex="0" aria-label="URxvt terminal">`,
    `          <header class="window-titlebar">`,
    `            <span>${text(USER_AT_HOST)}: ~</span>`,
    `            ${WINDOW_MARKS}`,
    `          </header>`,
    `          <div class="terminal-buffer" role="document">`,
    `            <p class="terminal-line">${agnoster('<span class="command">whoami</span>')}</p>`,
    `            <div class="terminal-output identity-output" data-site-whoami>`,
    `              <p class="identity-name"><span lang="zh">${text(identity.name)}</span> / ${text(identity.alternateName)}</p>`,
    `              <p>${text(identity.role.toLowerCase())}</p>`,
    `            </div>`,
    ``,
    `            <p class="terminal-line">${agnoster('<span class="command">cat ~/j3w1/README</span>')}</p>`,
    `            <div class="terminal-output readable-output" data-site-readme>`,
    ...home.readme.map((paragraph) => `              <p>${text(paragraph)}</p>`),
    `            </div>`,
    ``,
    `            <p class="terminal-line">${agnoster("<span class=\"command\">printf '%s\\n' focus/*</span>")}</p>`,
    `            <ul class="terminal-list" aria-label="Primary areas of focus">`,
    ...home.focus.map((item) => `              <li><span>focus/${text(item.name)}</span> ${text(item.text)}</li>`),
    `            </ul>`,
    ``,
    `            <p class="terminal-line terminal-ready">${agnoster('<span class="terminal-cursor" aria-hidden="true"></span>')}</p>`,
    `          </div>`,
    `          <footer class="terminal-statusline" aria-label="Terminal status">`,
    `            <span>URxvt</span><span>zsh</span><span>utf-8</span><span class="status-fill">~/</span>`,
    `          </footer>`,
    `        </article>`,
  ].join("\n");
};

export const homeFiles = (site) => {
  const counts = {
    projects: plural(site.projects.entries.length, "entry"),
    links: plural(site.elsewhere.links.length, "entry"),
  };
  const rows = FOLDERS.map((folder) => {
    const state = folder.count === "content"
      ? `<span data-content-count="${folder.workspace}">0 entries</span>`
      : `<span>${text(folder.state ?? counts[folder.count])}</span>`;
    const selected = folder.workspace === "home" ? " is-selected" : "";
    return `              <a class="file-row${selected}" href="#${folder.workspace}" data-workspace-link="${folder.workspace}"><span><span class="file-icon ui-icon" aria-hidden="true">${folder.icon}</span>${folder.workspace}/</span><span>${folder.type}</span>${state}</a>`;
  });
  return [
    `            <div class="file-view" role="region" aria-label="Workspace folders">`,
    `              <div class="file-row file-header" aria-hidden="true"><span>Name</span><span>Type</span><span>State</span></div>`,
    ...rows,
    `            </div>`,
  ].join("\n");
};

const visibilityLabel = (project) => (project.visibility === "public" ? "public" : "private / internal");

const factValue = (value) =>
  SAFE_HREF.test(value) && value.startsWith("https://")
    ? `<a href="${attr(value)}">${text(withoutScheme(value))} ↗</a>`
    : text(value);

export const projects = (site) => {
  const { entries, selected } = site.projects;
  const count = (visibility) => entries.filter((entry) => visibility === "all" || entry.visibility === visibility).length;
  const selectedEntry = entries.find((entry) => entry.id === selected);
  const rows = entries.map((project, index) => {
    const number = String(index + 1).padStart(2, "0");
    const isSelected = project.id === selected;
    const repository = project.repository
      ? `<a href="${attr(project.repository)}">GitHub ↗</a>`
      : "Private / internal";
    return `                  <tr${isSelected ? ' class="is-selected"' : ""} data-project-row="${attr(project.id)}" data-visibility="${attr(project.visibility)}"><td><button class="project-selector" type="button" data-project="${attr(project.id)}" aria-pressed="${isSelected}" aria-label="Show ${attr(project.name)} details">${number}</button></td><td>${text(project.name)}</td><td>${text(project.stack)}</td><td>${text(project.state)}</td><td>${repository}</td></tr>`;
  });
  const details = entries.map((project) => {
    const isSelected = project.id === selected;
    const facts = [
      ...project.facts.map(([key, value]) => `<div><dt>${text(key)}</dt><dd>${factValue(value)}</dd></div>`),
      `<div><dt>Repository</dt><dd>${project.repository ? `<a href="${attr(project.repository)}">${text(withoutScheme(project.repository))} ↗</a>` : "Private; no public link"}</dd></div>`,
    ].join("");
    return `            <article class="project-detail${isSelected ? " is-selected" : ""}" data-project-detail="${attr(project.id)}"><header><span>${text(project.name)}</span><span>${text(visibilityLabel(project))} · ${text(project.state.toLowerCase())}</span></header><p>${text(project.summary)}</p><dl>${facts}</dl></article>`;
  });
  const filterButton = (visibility, icon, label) =>
    `            <button class="toolbar-label project-filter-button" type="button" data-project-visibility="${visibility}" aria-pressed="${visibility === "all"}"><span class="ui-icon" aria-hidden="true">${icon}</span><span class="project-filter-label">${label}</span><span data-project-count="${visibility}">(${count(visibility)})</span></button>`;
  return [
    `        <article class="window pane project-window is-focused" data-wm-window="projects-table" data-wm-title="projects" tabindex="0" aria-label="Projects application">`,
    `          <header class="window-titlebar"><span>[${plural(entries.length, "entry")}] projects — ${text(site.site.name)}</span>${WINDOW_MARKS}</header>`,
    `          <div class="app-menu" aria-hidden="true"><span>Project</span><span>Edit</span><span>View</span><span>Tools</span><span>Help</span></div>`,
    `          <div class="project-toolbar">`,
    filterButton("all", "&#xf0ae;", "All projects"),
    filterButton("public", "&#xf0ac;", "Public"),
    filterButton("internal", "&#xf023;", "Internal"),
    `            <label class="filter-field" for="project-filter"><span class="ui-icon" aria-hidden="true">&#xf002;</span><span class="sr-only">Filter projects</span><input id="project-filter" type="search" autocomplete="off" placeholder="Filter project name…"></label>`,
    `          </div>`,
    `          <div class="project-table-pane">`,
    `            <div class="table-scroller">`,
    `              <table class="project-table">`,
    `                <caption class="sr-only">Current, public, and historical projects</caption>`,
    `                <colgroup>`,
    `                  <col class="project-col-number">`,
    `                  <col class="project-col-name">`,
    `                  <col class="project-col-stack">`,
    `                  <col class="project-col-state">`,
    `                  <col class="project-col-repository">`,
    `                </colgroup>`,
    `                <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Type / stack</th><th scope="col">State</th><th scope="col">Repository</th></tr></thead>`,
    `                <tbody>`,
    ...rows,
    `                </tbody>`,
    `              </table>`,
    `            </div>`,
    `          </div>`,
    `          <footer class="app-statusline"><span>${plural(entries.length, "entry")}</span><span>${count("public")} public</span><span>${count("internal")} internal</span><span class="status-fill">selection: <span id="project-status-selection">${text(selectedEntry.name)}</span></span></footer>`,
    `        </article>`,
    ``,
    `        <article class="window pane project-window" data-wm-window="projects-detail" data-wm-title="project detail" tabindex="0" aria-label="Project detail">`,
    `          <header class="window-titlebar"><span>project detail — ${text(site.site.name)}</span>${WINDOW_MARKS}</header>`,
    `          <div class="project-detail-pane" aria-live="polite">`,
    `            <p id="project-no-results" class="compact-state" hidden>No projects match this view.</p>`,
    ...details,
    `          </div>`,
    `          <footer class="app-statusline"><span>detail</span><span class="status-fill">selection: ${text(selectedEntry.name)}</span></footer>`,
    `        </article>`,
  ].join("\n");
};

/* The plain zsh prompt the elsewhere terminal shows. */
const plainPrompt = (command) =>
  `<span class="prompt-user">j3w1</span><span class="prompt-at">@</span><span class="prompt-host">manjaro</span><span class="prompt-path"> ~/elsewhere</span><span class="prompt-mark"> $ </span>${command}`;

export const elsewhere = (site) => {
  const { links, note } = site.elsewhere;
  const items = links.map((link) => {
    const rel = link.rel ? ` rel="${attr(link.rel)}"` : "";
    return `              <li><span class="permissions" aria-hidden="true">lrwxrwxrwx</span><a href="${attr(link.href)}"${rel}>${text(link.name)}</a><span aria-hidden="true"> → </span><span>${text(link.label ?? link.href)}</span></li>`;
  });
  return [
    `        <article class="window pane terminal-window elsewhere-window is-focused" data-wm-window="elsewhere-links" data-wm-title="~/elsewhere" tabindex="0" aria-label="External links terminal">`,
    `          <header class="window-titlebar"><span>${text(USER_AT_HOST)}: ~/elsewhere</span>${WINDOW_MARKS}</header>`,
    `          <div class="terminal-buffer" role="document">`,
    `            <p class="terminal-line">${plainPrompt('<span class="command">ls -l</span>')}</p>`,
    `            <p class="terminal-output terminal-muted">total ${links.length}</p>`,
    `            <ul class="link-list" aria-label="Public external destinations">`,
    ...items,
    `            </ul>`,
    `            <p class="terminal-line">${plainPrompt('<span class="command">cat note</span>')}</p>`,
    `            <p class="terminal-output readable-output">${text(note)}</p>`,
    `            <p class="terminal-line terminal-ready">${plainPrompt('<span class="terminal-cursor" aria-hidden="true"></span>')}</p>`,
    `          </div>`,
    `          <footer class="terminal-statusline"><span>URxvt</span><span>${plural(links.length, "link")}</span><span class="status-fill">~/elsewhere</span></footer>`,
    `        </article>`,
  ].join("\n");
};

/* A Vim buffer: numbered lines, blank lines between paragraphs, the cursor on
   the last line, and the statusline reporting it. */
const vimBuffer = ({ id, title, label, lines }) => {
  const numbered = [];
  lines.forEach((line, index) => {
    if (index > 0 && line.spaced !== false) numbered.push({ blank: true });
    numbered.push(line);
  });
  const last = numbered.length;
  const rows = numbered.map((line, index) => {
    const number = index + 1;
    const current = number === last ? " current-line" : "";
    if (line.blank) return `            <div class="prose-line prose-line-blank" data-line="${number}"><span></span></div>`;
    return `            <div class="prose-line${line.className ? ` ${line.className}` : ""}${current}" data-line="${number}">${line.html}</div>`;
  });
  return [
    `        <article class="window pane vim-window about-window${id === "about-editor" ? " is-focused" : ""}" data-wm-window="${id}" data-wm-title="${attr(title)}" tabindex="0" aria-label="${attr(label)}">`,
    `          <header class="window-titlebar"><span>${text(title)} (~/j3w1/about) — VIM</span>${WINDOW_MARKS}</header>`,
    `          <div class="vim-buffer about-buffer" role="document">`,
    ...rows,
    `          </div>`,
    `          <footer class="vim-statusline"><span class="vim-mode">NORMAL</span><span>${text(title)}</span><span class="status-fill">utf-8 · markdown</span><span>${last},1</span></footer>`,
    `        </article>`,
  ].join("\n");
};

export const about = (site) => {
  const { identity } = site;
  const aboutLines = [
    { html: `<p class="syntax-heading"># <span lang="zh">${text(identity.name)}</span> / ${text(identity.alternateName)}</p>` },
    { html: `<p class="about-role">${text(identity.role)}</p>`, spaced: false },
    ...site.about.paragraphs.map((paragraph) => ({ html: `<p>${richText(paragraph)}</p>` })),
  ];
  const interestLines = [
    { html: `<p class="syntax-heading">## working interests</p>` },
    ...site.about.interests.map((item, index) => ({
      className: "about-list-line",
      spaced: index === 0,
      html: `<p><span>· ${text(item.label)}</span> ${text(item.text)}</p>`,
    })),
  ];
  return [
    vimBuffer({ id: "about-editor", title: "about.md", label: "Vim biography buffer", lines: aboutLines }),
    vimBuffer({ id: "about-interests", title: "interests.md", label: "Vim working interests buffer", lines: interestLines }),
  ].join("\n");
};

/* The static pages' shell, shared with the generated entry pages. */
export const pageBar = ({ label, desktopHref }) => renderPageBar({ crumbs: [{ label, here: true }], desktopHref });
export const pageFoot = () => renderPageFoot();
