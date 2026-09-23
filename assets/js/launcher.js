/* dmenu: the command launcher. The catalogue is whatever the caller sets (the
   workspaces, help, and every i3 command the window manager exposes); typing
   ranks it, arrows move the selection, Enter runs it, and text that matches
   nothing is handed to `run` as an i3-msg command, the way dmenu hands
   unmatched input to the shell. */

export const createLauncher = ({ root, form, input, prefix, results, run }) => {
  let commands = [];
  let filtered = [];
  let selected = 0;
  let returnFocus = null;

  const isOpen = () => Boolean(root) && !root.hidden;

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

  const render = () => {
    if (!results || !input) return;
    const query = input.value.trim();
    filtered = commands
      .map((command, index) => ({ command, index, score: commandScore(command, query) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map((entry) => entry.command);
    selected = Math.min(
      selected,
      Math.max(filtered.length - 1, 0),
    );

    results.replaceChildren();
    filtered.forEach((command, index) => {
      const item = document.createElement("li");
      item.setAttribute("role", "presentation");
      const button = document.createElement("button");
      button.type = "button";
      button.id = `command-result-${index}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === selected));
      button.classList.toggle("is-selected", index === selected);
      button.tabIndex = -1;
      button.textContent = command.label;
      button.addEventListener("pointerenter", () => {
        if (selected === index) return;
        selected = index;
        results.querySelectorAll("[role='option']").forEach((option, optionIndex) => {
          const isSelected = optionIndex === selected;
          option.classList.toggle("is-selected", isSelected);
          option.setAttribute("aria-selected", String(isSelected));
        });
        input.setAttribute("aria-activedescendant", button.id);
      });
      button.addEventListener("click", () => execute(index));
      item.append(button);
      results.append(item);
    });

    const activeOption = results.querySelector(".is-selected");
    if (activeOption) {
      input.setAttribute("aria-activedescendant", activeOption.id);
      activeOption.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const close = ({ restoreFocus = true } = {}) => {
    if (!root || !isOpen()) return;
    root.hidden = true;
    input?.setAttribute("aria-expanded", "false");
    if (restoreFocus && returnFocus instanceof HTMLElement) {
      returnFocus.focus({ preventScroll: true });
    }
  };

  /* dmenu passes what you typed to the shell when nothing matches; here the
     typed text goes to i3-msg, so `gaps inner set 20`, `resize set 600 400` or
     `[con_mark=x] focus` work without a catalogue entry for every argument. */
  const execute = (index = selected) => {
    const command = filtered[index];
    const typed = input?.value.trim() ?? "";
    close();
    if (command) {
      command.run();
      return;
    }
    if (typed) run(typed);
  };

  /* `mark` is the key that opened it, `/` or `:`, echoed in the prompt. */
  const open = (mark) => {
    if (!root || !input) return;
    if (!isOpen()) returnFocus = document.activeElement;
    root.hidden = false;
    prefix.textContent = mark;
    input.value = "";
    input.setAttribute("aria-expanded", "true");
    selected = 0;
    render();
    input.focus({ preventScroll: true });
  };

  input?.addEventListener("input", () => {
    selected = 0;
    render();
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      execute();
      return;
    }

    if (["ArrowDown", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      if (filtered.length) {
        selected = (selected + 1) % filtered.length;
        render();
      }
      return;
    }

    if (["ArrowUp", "ArrowLeft"].includes(event.key)) {
      event.preventDefault();
      if (filtered.length) {
        selected =
          (selected - 1 + filtered.length) % filtered.length;
        render();
      }
    }
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    execute();
  });

  return {
    open,
    close,
    isOpen,
    setCommands: (next) => {
      commands = next;
    },
  };
};
