/* Routing, the command launcher, the help dialog, and the projects application.
   Window management lives in ./wm/ and is imported statically: a dynamic import
   would resolve after first paint and guarantee a visible reflow from the
   fallback grid to the window manager's layout. */

import { createWm } from "./wm/boot.js?v=20260905e";
import { isEditable } from "./wm/dom.js?v=20260905e";

const workspaceNames = [
  "home",
  "writing",
  "projects",
  "photography",
  "books",
  "elsewhere",
  "about",
];

const HOME_PATH = "/home/j3w1";

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
const announcer = document.querySelector("#workspace-announcer");
const skipLink = document.querySelector("[data-skip-link]");
const clock = document.querySelector("#local-clock");
const helpDialog = document.querySelector("#keyboard-help");
const commandLauncher = document.querySelector("#command-launcher");
const commandForm = document.querySelector("#command-form");
const commandInput = document.querySelector("#command-input");
const commandPrefix = document.querySelector("#command-prefix");
const commandResults = document.querySelector("#command-results");
const mobileQuery = window.matchMedia("(max-width: 767px)");

let activeWorkspace = "home";
let launcherReturnFocus = null;
let helpReturnFocus = null;
let filteredCommands = [];
let selectedCommandIndex = 0;
let projectVisibility = "all";
let wm = null;

const workspaceFromHash = () => {
  const candidate = decodeURIComponent(window.location.hash.slice(1)).toLowerCase().split("/")[0];
  return workspaceNames.includes(candidate) ? candidate : null;
};

const activateWorkspace = (
  name,
  { announce = false, moveFocus = false } = {},
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

  if (mobileQuery.matches) {
    document
      .querySelector(`.workspace-strip [data-workspace-link="${nextName}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  if (statusWorkspace) {
    statusWorkspace.textContent = nextName === "home" ? HOME_PATH : `${HOME_PATH}/${nextName}`;
  }
  if (skipLink) skipLink.setAttribute("href", `#${nextName}`);

  document.title =
    nextName === "home"
      ? "j3w1 — Writer · Software Engineer"
      : `${nextName} — j3w1`;

  /* Reading the layer's size right after the display flip forces the synchronous
     layout the window manager needs; that is intentional here. */
  wm?.setActiveWorkspace(nextName);

  if (moveFocus) {
    const id = wm?.focusedWindowId(nextName);
    if (id) wm.focusWindow(id);
    else workspaceSections.get(nextName)?.focus({ preventScroll: true });
  }
  if (announce && announcer) announcer.textContent = `${nextName} workspace active`;
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

const syncWorkspaceFromLocation = () => {
  activateWorkspace(workspaceFromHash() ?? "home", { announce: true });
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

window.addEventListener("popstate", syncWorkspaceFromLocation);
window.addEventListener("hashchange", syncWorkspaceFromLocation);

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

const selectProject = (projectId) => {
  const row = document.querySelector(`[data-project-row="${projectId}"]`);
  const detail = document.querySelector(`[data-project-detail="${projectId}"]`);
  if (!row || !detail) return;

  document.querySelectorAll("[data-project-row]").forEach((candidate) => {
    candidate.classList.toggle("is-selected", candidate === row);
  });
  document.querySelectorAll(".project-selector").forEach((selector) => {
    selector.setAttribute(
      "aria-pressed",
      String(selector.dataset.project === projectId),
    );
  });
  document.querySelectorAll("[data-project-detail]").forEach((candidate) => {
    candidate.classList.toggle("is-selected", candidate === detail);
  });

  const selectionStatus = document.querySelector("#project-status-selection");
  if (selectionStatus) selectionStatus.textContent = row.cells[1]?.textContent.trim() ?? projectId;
};

const applyProjectFilters = () => {
  const query = document.querySelector("#project-filter")?.value.trim().toLowerCase() ?? "";
  const rows = [...document.querySelectorAll("[data-project-row]")];
  rows.forEach((row) => {
    const categoryMatches = projectVisibility === "all" || row.dataset.visibility === projectVisibility;
    const textMatches = !query || row.textContent.toLowerCase().includes(query);
    row.hidden = !(categoryMatches && textMatches);
  });
  const visible = rows.filter((row) => !row.hidden);
  const selectedRow = document.querySelector("[data-project-row].is-selected");
  if (!selectedRow || selectedRow.hidden) {
    if (visible[0]) selectProject(visible[0].dataset.projectRow);
    else {
      document.querySelectorAll("[data-project-row].is-selected, [data-project-detail].is-selected").forEach((node) => node.classList.remove("is-selected"));
      document.querySelectorAll(".project-selector").forEach((button) => button.setAttribute("aria-pressed", "false"));
    }
  }
  const empty = document.querySelector("#project-no-results");
  if (empty) empty.hidden = visible.length > 0;
};

document.querySelectorAll("[data-project-count]").forEach((target) => {
  const visibility = target.dataset.projectCount;
  const count = visibility === "all" ? document.querySelectorAll("[data-project-row]").length : document.querySelectorAll(`[data-project-row][data-visibility="${visibility}"]`).length;
  target.textContent = `(${count})`;
});

document.querySelectorAll("[data-project-visibility]").forEach((button) => {
  button.addEventListener("click", () => {
    projectVisibility = button.dataset.projectVisibility;
    document.querySelectorAll("[data-project-visibility]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    applyProjectFilters();
  });
});

document.querySelectorAll(".project-selector").forEach((selector) => {
  selector.addEventListener("click", () => {
    selectProject(selector.dataset.project);
    wm?.focusWindow("projects-detail", { moveBrowserFocus: false });
  });
});

document.querySelectorAll("[data-project-row]").forEach((row) => {
  row.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    selectProject(row.dataset.projectRow);
  });

  row.addEventListener("focusin", () => {
    selectProject(row.dataset.projectRow);
  });
});

document.querySelector("#project-filter")?.addEventListener("input", () => {
  applyProjectFilters();
});

document.querySelector("#j3w1ctl-launch")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const module = await import("/admin/j3w1ctl.js?v=20260831");
    await module.openJ3w1ctl({ mount: document.querySelector("#j3w1ctl-root"), launcher: button });
  } finally {
    button.disabled = false;
  }
});

const dialogIsOpen = () => helpDialog?.hasAttribute("open");
const launcherIsOpen = () => commandLauncher && !commandLauncher.hidden;
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

let commands = baseCommands;

const isSubsequence = (haystack, needle) => {
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
};

/* Rank rather than merely filter. Subsequence matching is generous enough that
   typing an exact label can match a different command first — "exec feh" is a
   subsequence of "exec neofetch" — so a literal match has to outrank it. */
const commandScore = (command, query) => {
  if (!query) return 0;
  const label = command.label.toLowerCase();
  const needle = query.toLowerCase();
  if (label === needle) return 0;
  if (label.startsWith(needle)) return 1;
  if (label.includes(needle)) return 2;
  if ((command.aliases ?? "").toLowerCase().includes(needle)) return 3;
  if (isSubsequence(label, needle)) return 4;
  if (isSubsequence(`${label} ${command.aliases ?? ""}`.toLowerCase(), needle)) return 5;
  return -1;
};

const renderCommandResults = () => {
  if (!commandResults || !commandInput) return;
  const query = commandInput.value.trim();
  filteredCommands = commands
    .map((command, index) => ({ command, index, score: commandScore(command, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.command);
  selectedCommandIndex = Math.min(
    selectedCommandIndex,
    Math.max(filteredCommands.length - 1, 0),
  );

  commandResults.replaceChildren();
  filteredCommands.forEach((command, index) => {
    const item = document.createElement("li");
    item.setAttribute("role", "presentation");
    const button = document.createElement("button");
    button.type = "button";
    button.id = `command-result-${index}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === selectedCommandIndex));
    button.classList.toggle("is-selected", index === selectedCommandIndex);
    button.tabIndex = -1;
    button.textContent = command.label;
    button.addEventListener("pointerenter", () => {
      if (selectedCommandIndex === index) return;
      selectedCommandIndex = index;
      commandResults.querySelectorAll("[role='option']").forEach((option, optionIndex) => {
        const isSelected = optionIndex === selectedCommandIndex;
        option.classList.toggle("is-selected", isSelected);
        option.setAttribute("aria-selected", String(isSelected));
      });
      commandInput.setAttribute("aria-activedescendant", button.id);
    });
    button.addEventListener("click", () => executeCommand(index));
    item.append(button);
    commandResults.append(item);
  });

  const activeOption = commandResults.querySelector(".is-selected");
  if (activeOption) {
    commandInput.setAttribute("aria-activedescendant", activeOption.id);
    activeOption.scrollIntoView({ block: "nearest", inline: "nearest" });
  } else {
    commandInput.removeAttribute("aria-activedescendant");
  }
};

const closeLauncher = ({ restoreFocus = true } = {}) => {
  if (!commandLauncher || !launcherIsOpen()) return;
  commandLauncher.hidden = true;
  commandInput?.setAttribute("aria-expanded", "false");
  if (restoreFocus && launcherReturnFocus instanceof HTMLElement) {
    launcherReturnFocus.focus({ preventScroll: true });
  }
};

const executeCommand = (index = selectedCommandIndex) => {
  const command = filteredCommands[index];
  if (!command) return;
  closeLauncher();
  command.run();
};

const openLauncher = (prefix) => {
  if (!commandLauncher || !commandInput) return;
  if (!launcherIsOpen()) launcherReturnFocus = document.activeElement;
  commandLauncher.hidden = false;
  commandPrefix.textContent = prefix;
  commandInput.value = "";
  commandInput.setAttribute("aria-expanded", "true");
  selectedCommandIndex = 0;
  renderCommandResults();
  commandInput.focus({ preventScroll: true });
};

commandInput?.addEventListener("input", () => {
  selectedCommandIndex = 0;
  renderCommandResults();
});

commandInput?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeLauncher();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    executeCommand();
    return;
  }

  if (["ArrowDown", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    if (filteredCommands.length) {
      selectedCommandIndex = (selectedCommandIndex + 1) % filteredCommands.length;
      renderCommandResults();
    }
    return;
  }

  if (["ArrowUp", "ArrowLeft"].includes(event.key)) {
    event.preventDefault();
    if (filteredCommands.length) {
      selectedCommandIndex =
        (selectedCommandIndex - 1 + filteredCommands.length) % filteredCommands.length;
      renderCommandResults();
    }
  }
});

commandForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  executeCommand();
});

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;

  if (dialogIsOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeHelp();
    }
    return;
  }

  if (launcherIsOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeLauncher();
    }
    return;
  }

  if (curtainIsOpen()) return;
  if (isEditable(event.target)) return;

  if (event.key === "/" || event.key === ":") {
    event.preventDefault();
    openLauncher(event.key);
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
    isBlocked: () => Boolean(dialogIsOpen() || launcherIsOpen() || curtainIsOpen()),
    openLauncher,
  });
} catch (error) {
  console.error("[wm] boot failed; rendering the stacked fallback", error);
  wm = null;
}

if (wm) {
  commands = [...baseCommands, ...wm.commands()];
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
applyProjectFilters();
