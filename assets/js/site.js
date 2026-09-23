/* Routing, the help dialog, and the key dispatcher, with the launcher
   (launcher.js) and the projects application (projects.js) wired in.
   Window management lives in ./wm/ and is imported statically: a dynamic import
   would resolve after first paint and guarantee a visible reflow from the
   fallback grid to the window manager's layout. */

import { createWm } from "./wm/boot.js?v=20260923";
import { isEditable } from "./wm/dom.js?v=20260923";
import { announce, installAnnouncer } from "./wm/a11y.js?v=20260923";
import { IDENTITY } from "./wm/defaults.js?v=20260923";
import { media } from "./wm/session.js?v=20260923";
import { onRouteChange, parseRoute, WORKSPACES as workspaceNames } from "./route.js?v=20260923";
import { createLauncher } from "./launcher.js?v=20260923";
import { installProjects } from "./projects.js?v=20260923";

const HOME_PATH = IDENTITY.home;
/* The generated <title> is the home workspace's; other workspaces prefix it. */
const homeTitle = document.title;

const workspaceNumbers = new Map(
  workspaceNames.map((name, index) => [name, index + 1]),
);

const workspaceSections = new Map(
  [...document.querySelectorAll("[data-workspace]")].map((section) => [
    section.dataset.workspace,
    section,
  ]),
);

const workspaceLinks = [...document.querySelectorAll("[data-workspace-link]")];
const statusWorkspace = document.querySelector("#status-workspace");
/* Installed before boot so announcements work on the fallback path too; the
   window manager installs the same node again. */
installAnnouncer(document.querySelector("#workspace-announcer"));
const skipLink = document.querySelector("[data-skip-link]");
const clock = document.querySelector("#local-clock");
const helpDialog = document.querySelector("#keyboard-help");

let activeWorkspace = "home";
let helpReturnFocus = null;
let wm = null;

const workspaceFromHash = () => parseRoute(window.location.hash).workspace;

const activateWorkspace = (
  name,
  { announce: shouldAnnounce = false, moveFocus = false } = {},
) => {
  const nextName = workspaceNames.includes(name) ? name : "home";
  activeWorkspace = nextName;

  /* Visibility is CSS's: `.is-active` hides the other sections with display:none
     before the window manager boots and with visibility:hidden once it runs (a
     window moved to another workspace is shown from its own section), and the
     failed-boot fallback shows every section as one scrolling document. */
  workspaceSections.forEach((section, sectionName) => {
    section.classList.toggle("is-active", sectionName === nextName);
  });

  workspaceLinks.forEach((link) => {
    const isActive = link.dataset.workspaceLink === nextName;
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (media.mobile.matches) {
    document
      .querySelector(`.workspace-strip [data-workspace-link="${nextName}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  if (statusWorkspace) {
    statusWorkspace.textContent = nextName === "home" ? HOME_PATH : `${HOME_PATH}/${nextName}`;
  }
  if (skipLink) skipLink.setAttribute("href", `#${nextName}`);

  document.title = nextName === "home" ? homeTitle : `${nextName} — j3w1`;

  /* Reading the layer's size right after the display flip forces the synchronous
     layout the window manager needs; that is intentional here. */
  wm?.setActiveWorkspace(nextName);

  if (moveFocus) {
    const id = wm?.focusedWindowId(nextName);
    if (id) wm.focusWindow(id);
    else workspaceSections.get(nextName)?.focus({ preventScroll: true });
  }
  if (shouldAnnounce) announce(`${nextName} workspace active`);
};

const navigateToWorkspace = (
  name,
  { replace = false, moveFocus = false } = {},
) => {
  if (!workspaceNames.includes(name)) return;

  const nextHash = `#${name}`;
  if (window.location.hash !== nextHash) {
    const method = replace ? "replaceState" : "pushState";
    window.history[method]({ workspace: name }, "", nextHash);
  }

  activateWorkspace(name, { announce: true, moveFocus });
};

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-workspace-link]");
  if (!link || event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  event.preventDefault();
  navigateToWorkspace(link.dataset.workspaceLink);
});

skipLink?.addEventListener("click", (event) => {
  event.preventDefault();
  workspaceSections.get(activeWorkspace)?.focus({ preventScroll: true });
});

onRouteChange(({ workspace }) => activateWorkspace(workspace ?? "home", { announce: true }));

/* Tabbing into a window makes it the focused one, so keyboard navigation and
   the window manager's idea of focus never disagree. */
document.addEventListener("focusin", (event) => {
  const node = event.target.closest?.("[data-wm-window]");
  if (node) wm?.focusWindow(node.dataset.wmWindow, { moveBrowserFocus: false });
});

const activateFocusedItem = () => {
  const activeElement = document.activeElement;
  if (activeElement?.matches("a, button")) return;

  const section = workspaceSections.get(activeWorkspace);
  const pane = section?.querySelector("[data-wm-window].is-focused");
  const selected = pane?.querySelector(
    '.project-selector[aria-pressed="true"], .file-row.is-selected, .place-row.is-selected[href]',
  );
  selected?.click();
};

const projects = installProjects({
  onSelect: () => wm?.focusWindow("projects-detail", { moveBrowserFocus: false }),
});

document.querySelector("#j3w1ctl-launch")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const module = await import("/admin/j3w1ctl.js?v=20260923");
    await module.openJ3w1ctl({ mount: document.querySelector("#j3w1ctl-root"), launcher: button });
  } finally {
    button.disabled = false;
  }
});

const dialogIsOpen = () => helpDialog?.hasAttribute("open");
const curtainIsOpen = () =>
  document.querySelector("#photo-viewer")?.open ||
  document.querySelector("#greeter")?.hidden === false ||
  document.querySelector("#power-menu")?.hidden === false ||
  document.querySelector("#lockscreen")?.hidden === false;

const renderHelpBindings = () => {
  const list = document.querySelector("#help-bindings");
  if (!list || !wm) return;
  list.replaceChildren();
  [...wm.bindings(), ...wm.resizeBindings()].forEach(({ keys, description }) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = keys;
    const detail = document.createElement("dd");
    detail.textContent = description;
    row.append(term, detail);
    list.append(row);
  });
};

const openHelp = () => {
  if (!helpDialog || dialogIsOpen()) return;
  helpReturnFocus = document.activeElement;
  renderHelpBindings();
  if (typeof helpDialog.showModal === "function") helpDialog.showModal();
  else helpDialog.setAttribute("open", "");
  helpDialog.querySelector("[data-close-help]")?.focus();
};

const closeHelp = () => {
  if (!helpDialog || !dialogIsOpen()) return;
  if (typeof helpDialog.close === "function") helpDialog.close();
  else helpDialog.removeAttribute("open");
  if (helpReturnFocus instanceof HTMLElement) helpReturnFocus.focus();
};

helpDialog?.querySelector("[data-close-help]")?.addEventListener("click", closeHelp);
helpDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeHelp();
});

const baseCommands = [
  ...workspaceNames.map((name) => ({
    label: `open ${name}`,
    aliases: `${workspaceNumbers.get(name)} ${name} workspace`,
    run: () => navigateToWorkspace(name, { moveFocus: true }),
  })),
  {
    label: "open github",
    aliases: "github profile code",
    run: () => window.location.assign("https://github.com/j3w1"),
  },
  { label: "help", aliases: "keys keyboard shortcuts man", run: openHelp },
];

const launcher = createLauncher({
  root: document.querySelector("#command-launcher"),
  form: document.querySelector("#command-form"),
  input: document.querySelector("#command-input"),
  prefix: document.querySelector("#command-prefix"),
  results: document.querySelector("#command-results"),
  run: (typed) => {
    const result = wm?.runCommand(typed);
    if (result) announce(`i3-msg: ${result}`);
  },
});
launcher.setCommands(baseCommands);

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;

  if (dialogIsOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeHelp();
    }
    return;
  }

  if (launcher.isOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      launcher.close();
    }
    return;
  }

  if (curtainIsOpen()) return;
  if (isEditable(event.target)) return;

  if (event.key === "/" || event.key === ":") {
    event.preventDefault();
    launcher.open(event.key);
    return;
  }

  if (event.key === "?") {
    event.preventDefault();
    openHelp();
    return;
  }

  if (event.key === "Enter" && !event.altKey) activateFocusedItem();
});

/* A throw anywhere in boot must land in the stacked fallback, never in a
   half-initialised desktop: html.js has already hidden six workspaces and
   locked body scrolling, and only data-wm="off" undoes that. The inline head
   script covers the failures this catch cannot see — a module that fails to
   load at all — with a window error listener and a boot deadline. */
try {
  wm = createWm({
    onWorkspaceRequest: (index) => navigateToWorkspace(workspaceNames[index - 1], { moveFocus: true }),
    isBlocked: () => Boolean(dialogIsOpen() || launcher.isOpen() || curtainIsOpen()),
    openLauncher: launcher.open,
  });
} catch (error) {
  console.error("[wm] boot failed; rendering the stacked fallback", error);
  wm = null;
}

if (wm) {
  launcher.setCommands([...baseCommands, ...wm.commands()]);
  renderHelpBindings();
} else {
  /* Boot failed or the browser is too old: fall back to the same stacked,
     scrolling layout that visitors without JavaScript already get. */
  document.documentElement.dataset.wm = "off";
  /* Plain mode and boot failures keep their own clock; the window manager's
     status bar owns it otherwise, where it is suspended in background tabs. */
  const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const updateClock = () => {
    if (!clock) return;
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = clockFormat.format(now);
  };
  updateClock();
  window.setInterval(updateClock, 1000);
}

const initialWorkspace = workspaceFromHash() ?? "home";
if (!workspaceFromHash()) {
  window.history.replaceState(
    { workspace: initialWorkspace },
    "",
    `${window.location.pathname}${window.location.search}#${initialWorkspace}`,
  );
}
activateWorkspace(initialWorkspace);
projects.applyFilters();
