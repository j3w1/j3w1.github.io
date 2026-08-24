(() => {
  "use strict";

  const workspaceNames = [
    "home",
    "writing",
    "projects",
    "photography",
    "books",
    "elsewhere",
    "about",
  ];

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
  const statusPath = document.querySelector("#status-path");
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

  const isEditable = (element) =>
    element instanceof HTMLElement &&
    (element.matches("input, textarea, select") || element.isContentEditable);

  const workspaceFromHash = () => {
    const candidate = decodeURIComponent(window.location.hash.slice(1)).toLowerCase().split("/")[0];
    return workspaceNames.includes(candidate) ? candidate : null;
  };

  const firstVisiblePane = (section) =>
    [...section.querySelectorAll(".pane")].find(
      (pane) => pane.getClientRects().length > 0,
    );

  const focusPane = (pane, moveBrowserFocus = true) => {
    if (!(pane instanceof HTMLElement)) return;

    const section = pane.closest("[data-workspace]");
    section?.querySelectorAll(".pane.is-focused").forEach((candidate) => {
      candidate.classList.remove("is-focused");
    });

    pane.classList.add("is-focused");
    if (moveBrowserFocus) pane.focus({ preventScroll: true });
  };

  const activateWorkspace = (
    name,
    { announce = false, moveFocus = false } = {},
  ) => {
    const nextName = workspaceNames.includes(name) ? name : "home";
    activeWorkspace = nextName;

    workspaceSections.forEach((section, sectionName) => {
      const isActive = sectionName === nextName;
      section.classList.toggle("is-active", isActive);
      section.hidden = !isActive;
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

    const number = workspaceNumbers.get(nextName);
    if (statusWorkspace) statusWorkspace.textContent = `${number}:${nextName}`;
    if (statusPath) {
      statusPath.textContent = nextName === "home" ? "~/j3w1" : `~/j3w1/${nextName}`;
    }
    if (skipLink) skipLink.setAttribute("href", `#${nextName}`);

    document.title =
      nextName === "home"
        ? "j3w1 — Writer · Software Engineer"
        : `${nextName} — j3w1`;

    const section = workspaceSections.get(nextName);
    if (moveFocus && section) focusPane(firstVisiblePane(section));
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

  document.addEventListener("pointerdown", (event) => {
    const pane = event.target.closest(".pane");
    if (pane) focusPane(pane, false);
  });

  document.addEventListener("focusin", (event) => {
    const pane = event.target.closest?.(".pane");
    if (pane) focusPane(pane, false);
  });

  const movePaneFocus = (direction) => {
    const section = workspaceSections.get(activeWorkspace);
    if (!section) return false;

    const panes = [...section.querySelectorAll(".pane")].filter(
      (pane) => pane.getClientRects().length > 0,
    );
    if (panes.length < 2) return false;

    const current = section.querySelector(".pane.is-focused") ?? panes[0];
    const currentRect = current.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2,
    };

    const candidates = panes
      .filter((pane) => pane !== current)
      .map((pane) => {
        const rect = pane.getBoundingClientRect();
        const center = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        const deltaX = center.x - currentCenter.x;
        const deltaY = center.y - currentCenter.y;
        const valid =
          (direction === "left" && deltaX < -2) ||
          (direction === "right" && deltaX > 2) ||
          (direction === "up" && deltaY < -2) ||
          (direction === "down" && deltaY > 2);

        if (!valid) return null;

        const primary =
          direction === "left" || direction === "right"
            ? Math.abs(deltaX)
            : Math.abs(deltaY);
        const secondary =
          direction === "left" || direction === "right"
            ? Math.abs(deltaY)
            : Math.abs(deltaX);

        return { pane, score: primary * 10 + secondary };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score);

    if (!candidates.length) return false;
    focusPane(candidates[0].pane);
    return true;
  };

  const activateFocusedItem = () => {
    const activeElement = document.activeElement;
    if (activeElement?.matches("a, button")) return;

    const section = workspaceSections.get(activeWorkspace);
    const pane = section?.querySelector(".pane.is-focused");
    const selected = pane?.querySelector(
      '.project-selector[aria-pressed="true"], .file-row.is-selected, .place-row.is-selected[href]',
    );
    selected?.click();
  };

  const setupBufferTabs = () => {
    document.querySelectorAll(".mobile-buffer-tabs").forEach((tablist, listIndex) => {
      const section = tablist.closest("[data-workspace]");
      const tabs = [...tablist.querySelectorAll("[data-buffer-target]")];
      const targetNames = tabs.map((tab) => tab.dataset.bufferTarget);

      tabs.forEach((tab, tabIndex) => {
        const targetName = tab.dataset.bufferTarget;
        const target = section?.querySelector(`[data-pane="${targetName}"]`);
        if (!target) return;

        const targetId = `mobile-buffer-${listIndex}-${tabIndex}`;
        target.id = target.id || targetId;
        target.setAttribute("role", "tabpanel");
        tab.setAttribute("aria-controls", target.id);

        tab.addEventListener("click", () => {
          tabs.forEach((candidate) => {
            const isActive = candidate === tab;
            candidate.classList.toggle("is-active", isActive);
            candidate.setAttribute("aria-selected", String(isActive));
            candidate.tabIndex = isActive ? 0 : -1;
          });

          targetNames.forEach((candidateName) => {
            section
              ?.querySelector(`[data-pane="${candidateName}"]`)
              ?.classList.toggle("is-mobile-active", candidateName === targetName);
          });

          if (target.classList.contains("pane")) focusPane(target);
          else target.querySelector("button, a, input")?.focus({ preventScroll: true });
        });
      });
    });
  };

  const openProjectDetailBuffer = () => {
    if (!mobileQuery.matches) return;
    const tab = document.querySelector(
      '#projects [data-buffer-target="project-detail"]',
    );
    tab?.click();
  };

  const selectProject = (projectId, { showOnMobile = false } = {}) => {
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
    if (showOnMobile) openProjectDetailBuffer();
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
      selectProject(selector.dataset.project, { showOnMobile: true });
    });
  });

  document.querySelectorAll("[data-project-row]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      selectProject(row.dataset.projectRow, { showOnMobile: true });
    });

    row.addEventListener("focusin", () => {
      selectProject(row.dataset.projectRow);
    });
  });

  document.querySelector("#project-filter")?.addEventListener("input", (event) => {
    applyProjectFilters();
  });

  document.querySelector("#j3w1ctl-launch")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const module = await import("/admin/j3w1ctl.js?v=20260824c");
      await module.openJ3w1ctl({ mount: document.querySelector("#j3w1ctl-root"), launcher: button });
    } finally {
      button.disabled = false;
    }
  });

  const dialogIsOpen = () => helpDialog?.hasAttribute("open");

  const openHelp = () => {
    if (!helpDialog || dialogIsOpen()) return;
    helpReturnFocus = document.activeElement;
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

  const commands = [
    ...workspaceNames.map((name) => ({
      label: `open ${name}`,
      aliases: `${workspaceNumbers.get(name)} ${name}`,
      run: () => navigateToWorkspace(name, { moveFocus: true }),
    })),
    {
      label: "open github",
      aliases: "github profile code",
      run: () => window.location.assign("https://github.com/j3w1"),
    },
    { label: "help", aliases: "keys keyboard shortcuts", run: openHelp },
  ];

  const fuzzyMatches = (value, query) => {
    if (!query) return true;
    const haystack = value.toLowerCase();
    const needle = query.toLowerCase();
    if (haystack.includes(needle)) return true;

    let cursor = 0;
    for (const character of haystack) {
      if (character === needle[cursor]) cursor += 1;
      if (cursor === needle.length) return true;
    }
    return false;
  };

  const renderCommandResults = () => {
    if (!commandResults || !commandInput) return;
    const query = commandInput.value.trim();
    filteredCommands = commands.filter((command) =>
      fuzzyMatches(`${command.label} ${command.aliases}`, query),
    );
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

  const launcherIsOpen = () => commandLauncher && !commandLauncher.hidden;

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

    if (isEditable(event.target)) return;

    if (/^[1-7]$/.test(event.key)) {
      event.preventDefault();
      navigateToWorkspace(workspaceNames[Number(event.key) - 1], { moveFocus: true });
      return;
    }

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

    const directions = {
      h: "left",
      j: "down",
      k: "up",
      l: "right",
      ArrowLeft: "left",
      ArrowDown: "down",
      ArrowUp: "up",
      ArrowRight: "right",
    };

    const direction = directions[event.key];
    const isArrow = event.key.startsWith("Arrow");
    const activeElementIsInPane = document.activeElement?.closest?.(".pane");
    if (direction && (!isArrow || activeElementIsInPane)) {
      if (movePaneFocus(direction)) event.preventDefault();
      return;
    }

    if (event.key === "Enter") activateFocusedItem();
  });

  const updateClock = () => {
    if (!clock) return;
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(now);
  };

  setupBufferTabs();

  const initialWorkspace = workspaceFromHash() ?? "home";
  if (!workspaceFromHash()) {
    window.history.replaceState(
      { workspace: initialWorkspace },
      "",
      `${window.location.pathname}${window.location.search}#${initialWorkspace}`,
    );
  }
  activateWorkspace(initialWorkspace);
  updateClock();
  window.setInterval(updateClock, 1000);
})();
