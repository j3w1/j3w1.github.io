/* An interactive URxvt shell over a virtual filesystem projected from the real
   site: the content index, the project table, and the link list are the same
   data the workspaces render, just addressed as paths.

   All output is written with textContent. Markdown bodies are handed to the
   existing restricted-AST renderer rather than to innerHTML, so the shell adds
   no new way for content to reach the DOM as markup. */

import { renderAst } from "../../content-renderer.js?v=20260824";
import { loadContentIndex } from "../../content-index.js?v=20260905k";
import { BOOT_BANNER, BOOT_LOG } from "../console.js?v=20260905k";
import { element } from "../dom.js?v=20260905k";

const HOME = "/home/j3w1";

const README = [
  "I build the machinery behind dependable work: business platforms, developer",
  "environments, and delivery automation designed to be clear, secure,",
  "recoverable, and useful long after the first release.",
];

/* Two separate things, and conflating them was confusing: these are commands you
   type here, and those are keys you press anywhere on the desktop. */
const SHELL_COMMANDS = [
  ["ls", "list what is in the current directory"],
  ["cd <dir>", "change directory — try: cd writing (cd .. goes back)"],
  ["cat <file>", "read an entry, a project, or a page"],
  ["open <name>", "jump to a workspace, an entry, or a link"],
  ["pwd", "print the current directory"],
  ["tree", "show the whole site as a directory tree"],
  ["neofetch", "system information, read from your own browser"],
  ["htop", "the open windows, as processes"],
  ["feh", "pick a wallpaper"],
  ["cmatrix", "you know what this does"],
  ["dmenu", "open the command launcher (same as pressing /)"],
  ["keys", "list the window manager keyboard shortcuts"],
  ["wiki", "open the full guide in a new tab"],
  ["i3-msg <cmd>", "run a window manager command, e.g. i3-msg layout tabbed"],
  ["i3exit <action>", "lock, logout, suspend, hibernate, reboot, shutdown — or just: reboot"],
  ["journalctl -b", "this boot's log"],
  ["cat ~/.config/i3/config", "the original machine's dotfiles: i3, i3status, dunst, .Xresources"],
  ["xrandr, screenlayout", "the display (real) and the historical three-monitor layout"],
  ["notify-send <text>", "a dunst notification"],
  ["conky", "the desktop's conky panel"],
  ["logout", "end the session and return to the login screen"],
  ["clear", "clear this terminal"],
  ["whoami", "who you are talking to"],
  ["help", "this list"],
];

const WM_KEYS = [
  ["1 – 7", "switch workspace"],
  ["h j k l", "move focus between windows"],
  ["w / s / e", "tabbed / stacked / untile the windows"],
  ["f", "fullscreen the focused window"],
  ["q", "close the focused window"],
  ["r", "resize mode (then h j k l, Escape to leave)"],
  ["Alt + drag", "move a window; drag the gap between tiles to resize"],
  ["Shift + R", "put every window back exactly as it started"],
  ["/ or :", "open the command launcher"],
  ["?", "the full key map"],
];

const loadIndex = loadContentIndex;

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

/* The tree is rebuilt on demand so published content appears without a reload. */
const HOSTNAME = "manjaro";
const KERNEL = "6.12.4-1-MANJARO";

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
const readDotfile = async (name) => {
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

const buildTree = async () => {
  const index = await loadIndex();
  const collection = (name) => index?.collections?.[name] ?? [];
  const entries = (name) =>
    Object.fromEntries(collection(name).map((entry) => [`${entry.slug}.md`, { kind: name, entry }]));

  return {
    README: { kind: "text", lines: README },
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

const WORKSPACE_FOR_DIR = {
  "writing/": "writing",
  "books/": "books",
  "photography/": "photography",
  "projects/": "projects",
  "elsewhere/": "elsewhere",
  "about/": "about",
};

export const createShell = ({ body, statusline, wm, close, title }) => {
  const buffer = body.querySelector(".terminal-buffer") ?? body;
  buffer.querySelector(".terminal-ready")?.remove();

  const history = [];
  let historyIndex = 0;
  let cwd = [];
  let tree = null;

  const promptPath = () => (cwd.length ? `~/${cwd.map((segment) => segment.replace(/\/$/, "")).join("/")}` : "~");

  /* The prompt spans live inside a wrapper because the input line is a flex
     container, and flex layout trims the leading spaces the prompt relies on. */
  /* oh-my-zsh agnoster with prompt_context(){} — the original .zshrc hid the
     user@host segment, so the prompt is the directory segment alone, closed by
     the powerline arrow. No git segment: the virtual filesystem is not a
     repository, and a branch name would be invented. */
  const makePrompt = () => {
    const line = element("p", "terminal-line");
    const prompt = element("span", "shell-prompt agnoster");
    const dir = element("span", "prompt-path", promptPath());
    const arrow = element("span", "prompt-mark", "\ue0b0");
    arrow.setAttribute("aria-hidden", "true");
    prompt.append(dir, arrow, element("span", "prompt-space", " "));
    line.append(prompt);
    return line;
  };

  const input = element("input", "shell-input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Terminal command");

  const inputLine = makePrompt();
  inputLine.classList.add("shell-line");
  inputLine.append(input);
  buffer.append(inputLine);

  const scroll = () => {
    buffer.scrollTop = buffer.scrollHeight;
  };

  const print = (text, className = "terminal-output") => {
    const node = element("p", className, text);
    buffer.insertBefore(node, inputLine);
    return node;
  };

  const printLines = (lines, className) => {
    lines.forEach((line) => print(line, className || (line ? "terminal-output" : "terminal-output terminal-muted")));
  };

  const echoCommand = (value) => {
    const line = makePrompt();
    line.append(element("span", "command", value));
    buffer.insertBefore(line, inputLine);
  };

  const currentDir = () => {
    let node = { kind: "dir", children: tree };
    for (const segment of cwd) {
      const next = node.children?.[segment];
      if (!next || next.kind !== "dir") return node;
      node = next;
    }
    return node;
  };

  const lookup = (dir, name) => dir.children?.[name] ?? dir.children?.[`${name}/`] ?? dir.children?.[`${name}.md`] ?? null;

  /* A path from the home directory or the current one, with . and .. */
  const resolve = (name) => {
    const cleaned = String(name ?? "").replace(/\/+$/, "");
    if (!cleaned) return null;
    const fromHome = cleaned === "~" || cleaned.startsWith("~/") || cleaned.startsWith(HOME);
    const relative = cleaned.replace(new RegExp(`^(~|${HOME.replace(/\//g, "\\/")})/?`), "");
    const segments = relative.split("/").filter((segment) => segment && segment !== ".");
    let node = fromHome ? { kind: "dir", children: tree } : currentDir();
    const stack = fromHome ? [] : [...cwd];
    for (const segment of segments) {
      if (segment === "..") {
        stack.pop();
        node = { kind: "dir", children: tree };
        for (const step of stack) node = node.children?.[step] ?? node;
        continue;
      }
      const next = lookup(node, segment);
      if (!next) return null;
      if (next.kind === "dir") stack.push(segment.endsWith("/") ? segment : `${segment}/`);
      node = next;
    }
    return node === currentDir() && !segments.length ? null : node;
  };

  const listNames = () => Object.keys(currentDir().children ?? {});

  /* Rendered as a real two-column list so the command and its description are
     visually distinct — the previous flat prose was hard to read as a reference. */
  const printPairs = (pairs) => {
    const list = element("ul", "terminal-list shell-help");
    pairs.forEach(([name, description]) => {
      const item = element("li");
      item.append(element("span", "", name));
      item.append(document.createTextNode(description));
      list.append(item);
    });
    buffer.insertBefore(list, inputLine);
  };

  const showHelp = () => {
    print("Commands you can type here:", "terminal-output readable-output");
    printPairs(SHELL_COMMANDS);
    print("", "terminal-output");
    print("Keys you press anywhere on the desktop (not in this terminal):", "terminal-output readable-output");
    printPairs(WM_KEYS);
    print("", "terminal-output");
    print(
      "Nothing here can be broken permanently: reloading restores the desktop.",
      "terminal-output terminal-muted",
    );
    print("Full guide, with every hotkey: type 'wiki', or visit /wiki/", "terminal-output terminal-muted");
  };

  const commands = {
    help: showHelp,
    man: showHelp,
    "?": showHelp,
    keys: () => {
      print("Window manager keys — press these anywhere on the desktop:", "terminal-output readable-output");
      printPairs(WM_KEYS);
    },
    wiki: () => {
      print("opening /wiki/ …", "terminal-output terminal-muted");
      window.open("/wiki/", "_blank", "noopener");
    },
    dmenu: () => {
      print("opening dmenu…", "terminal-output terminal-muted");
      wm.openLauncher();
    },
    logout: () => wm.logout(),
    pwd: () => print(cwd.length ? `${HOME}/${cwd.map((segment) => segment.replace(/\/$/, "")).join("/")}` : HOME),
    whoami: () => {
      print("申杰 / j3w1", "terminal-output identity-output");
      print("writer · software engineer");
    },
    clear: () => {
      [...buffer.children].forEach((child) => {
        if (child !== inputLine) child.remove();
      });
    },
    date: () => print(new Date().toString()),
    ls: () => {
      const names = listNames();
      if (!names.length) return print("total 0", "terminal-output terminal-muted");
      const list = element("ul", "terminal-list");
      names.forEach((name) => {
        const item = element("li");
        item.append(element("span", "", name));
        const node = currentDir().children[name];
        item.append(document.createTextNode(
          node.kind === "dir" ? "directory"
            : node.kind === "photos" ? `${node.entry.images.length} photographs`
            : node.kind === "link" ? node.link.href
            : node.kind === "project" ? node.project.state.toLowerCase()
            : node.kind === "dotfile" ? "config"
            : "file",
        ));
        list.append(item);
      });
      buffer.insertBefore(list, inputLine);
    },
    tree: () => {
      const walk = (children, depth) => {
        Object.entries(children ?? {}).forEach(([name, node]) => {
          print(`${"  ".repeat(depth)}${name}`, "terminal-output terminal-muted");
          if (node.kind === "dir" && depth < 1) walk(node.children, depth + 1);
        });
      };
      walk(tree, 0);
    },
    cd: (argument) => {
      if (!argument || argument === "~" || argument === HOME) {
        cwd = [];
        return;
      }
      const target = resolve(argument);
      if (!target) return print(`cd: no such directory: ${argument}`, "terminal-output terminal-muted");
      if (target.kind !== "dir") return print(`cd: not a directory: ${argument}`, "terminal-output terminal-muted");
      /* Re-walk from the root so the new cwd is the resolved path, whatever
         form the argument took. */
      const fromHome = argument.startsWith("~") || argument.startsWith(HOME);
      const next = fromHome ? [] : [...cwd];
      for (const segment of argument.replace(new RegExp(`^(~|${HOME.replace(/\//g, "\\/")})/?`), "").split("/").filter(Boolean)) {
        if (segment === "..") next.pop();
        else if (segment !== ".") next.push(segment.endsWith("/") ? segment : `${segment}/`);
      }
      cwd = next;
    },
    cat: (argument) => {
      if (!argument) return print("cat: missing operand", "terminal-output terminal-muted");
      const target = resolve(argument);
      if (!target) return print(`cat: ${argument}: no such file`, "terminal-output terminal-muted");
      if (target.kind === "text") return printLines(target.lines, "terminal-output readable-output");
      if (target.kind === "dotfile") {
        return readDotfile(target.file).then((content) => {
          if (content === null) return print(`cat: ${argument}: unreadable`, "terminal-output terminal-muted");
          const pre = element("pre", "terminal-output terminal-dotfile", content);
          buffer.insertBefore(pre, inputLine);
        });
      }
      if (target.kind === "link") return print(`${target.link.name} -> ${target.link.href}`);
      if (target.kind === "dir" || target.kind === "photos") {
        return print(`cat: ${argument}: is a directory`, "terminal-output terminal-muted");
      }
      if (target.kind === "project") {
        const { project } = target;
        printLines([
          `# ${project.name}`,
          "",
          `stack:      ${project.stack}`,
          `state:      ${project.state}`,
          `repository: ${project.repository}`,
        ], "terminal-output readable-output");
        return;
      }
      if (target.kind === "dom") {
        const source = document.querySelector(target.selector);
        if (!source) return print(`cat: ${argument}: unreadable`, "terminal-output terminal-muted");
        printLines(
          [...source.querySelectorAll(".prose-line")].map((line) => line.textContent.trim()),
          "terminal-output readable-output",
        );
        return;
      }
      const blocks = target.entry.blocks ?? target.entry.notes;
      if (!Array.isArray(blocks)) return print(`cat: ${argument}: no readable body`, "terminal-output terminal-muted");
      const container = element("div", "terminal-output rendered-content");
      buffer.insertBefore(container, inputLine);
      renderAst(blocks, container);
    },
    open: (argument) => {
      const name = (argument ?? "").replace(/\/$/, "");
      if (!name) return print("open: missing operand", "terminal-output terminal-muted");
      const target = resolve(name);
      if (target?.kind === "link") {
        print(`opening ${target.link.href}`);
        window.open(target.link.href, "_blank", "noopener");
        return;
      }
      const workspace = WORKSPACE_FOR_DIR[`${name}/`] ?? (name === "home" ? "home" : null);
      if (workspace) {
        print(`switching to ${workspace}`);
        wm.openWorkspace(workspace);
        return;
      }
      if (target && (target.kind === "writing" || target.kind === "books" || target.kind === "photos")) {
        const collection = target.kind === "photos" ? "photography" : target.kind;
        wm.openRoute(`${collection}/${target.entry.slug}`);
        print(`opening ${collection}/${target.entry.slug}`);
        return;
      }
      print(`open: cannot open ${name}`, "terminal-output terminal-muted");
    },
    neofetch: () => wm.spawn("neofetch"),
    htop: () => wm.spawn("htop"),
    cmatrix: () => wm.spawn("cmatrix"),
    feh: () => wm.spawn("feh"),
    "i3-msg": (argument, rest) => {
      const result = wm.runCommand([argument, ...rest].filter(Boolean).join(" "));
      print(result ? `i3-msg: ${result}` : "i3-msg: ok", "terminal-output terminal-muted");
    },
    i3exit: (argument = "logout") => {
      if (!wm.power(argument)) print(`i3exit: unknown action ${argument}`, "terminal-output terminal-muted");
    },
    reboot: () => wm.power("reboot"),
    poweroff: () => wm.power("shutdown"),
    shutdown: () => wm.power("shutdown"),
    systemctl: (argument, rest) => {
      const result = wm.runCommand(["systemctl", argument, ...rest].filter(Boolean).join(" "));
      if (result) print(result, "terminal-output terminal-muted");
    },
    journalctl: () => {
      printLines(BOOT_BANNER.map((line) => `-- ${line}`), "terminal-output terminal-muted");
      printLines(BOOT_LOG.map(([kind, text]) => (kind === "ok" ? `[  OK  ] ${text}` : kind === "start" ? `[      ] ${text}` : text)), "terminal-output terminal-muted");
    },
    dunstctl: (argument) => {
      if (argument === "close-all" || argument === "close") return wm.closeNotifications();
      print("usage: dunstctl close-all", "terminal-output terminal-muted");
    },
    "notify-send": (argument, rest) => {
      if (!argument) return print("notify-send: no summary specified", "terminal-output terminal-muted");
      const [summary, ...body] = [argument, ...rest].join(" ").split(/\s{2,}|\\n/);
      wm.notify(summary, body.join(" "));
    },
    xrandr: () => {
      const ratio = window.devicePixelRatio ?? 1;
      printLines([
        `Screen 0: minimum 1 x 1, current ${screen.width} x ${screen.height}, maximum 16384 x 16384`,
        `browser connected primary ${window.innerWidth}x${window.innerHeight}+0+0 (viewport, ${ratio}x)`,
        "   the historical three-monitor layout is in ~/.screenlayout/j3w1-obsidian.sh (type: screenlayout)",
      ], "terminal-output terminal-muted");
    },
    screenlayout: () => commands.cat("~/.screenlayout/j3w1-obsidian.sh"),
    uname: (argument) => print(argument === "-a" ? `Linux ${HOSTNAME} ${KERNEL} #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux` : "Linux"),
    hostname: () => print(HOSTNAME),
    uptime: () => {
      const seconds = Math.floor(performance.now() / 1000);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const stamp = new Date().toTimeString().slice(0, 8);
      print(` ${stamp} up ${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : `${minutes} min`},  1 user (session uptime)`, "terminal-output terminal-muted");
    },
    conky: () => wm.spawn("conky"),
    echo: (argument, rest) => print([argument, ...rest].filter(Boolean).join(" ")),
    exit: () => close(),
  };

  const run = async (raw) => {
    const value = raw.trim();
    echoCommand(raw);
    if (!value) return;
    history.push(value);
    historyIndex = history.length;
    const [name, argument, ...rest] = value.split(/\s+/);
    tree = await buildTree();
    const command = commands[name];
    if (!command) {
      print(`${name}: command not found`, "terminal-output terminal-muted");
      if (name.startsWith("/") || name.startsWith(":")) {
        print(
          "That is a desktop shortcut, not a command: press / outside the terminal, or type 'dmenu'.",
          "terminal-output terminal-muted",
        );
      } else {
        print("Type 'help' for the commands you can use here.", "terminal-output terminal-muted");
      }
      return;
    }
    try {
      await command(argument, rest);
    } catch {
      print(`${name}: failed`, "terminal-output terminal-muted");
    }
  };

  const complete = () => {
    const value = input.value;
    const parts = value.split(/\s+/);
    const partial = parts[parts.length - 1] ?? "";
    const pool = parts.length <= 1 ? Object.keys(commands) : listNames();
    const matches = pool.filter((name) => name.startsWith(partial));
    if (!matches.length) return;
    if (matches.length === 1) {
      parts[parts.length - 1] = matches[0];
      input.value = parts.join(" ");
      return;
    }
    print(matches.join("  "), "terminal-output terminal-muted");
    scroll();
  };

  const onKeydown = async (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      const value = input.value;
      input.value = "";
      await run(value);
      inputLine.querySelector(".shell-prompt .prompt-path").textContent = promptPath();
      updateStatus();
      scroll();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      complete();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!history.length) return;
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex] ?? "";
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!history.length) return;
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] ?? "";
      return;
    }
    if (event.key === "c" && event.ctrlKey) {
      event.preventDefault();
      echoCommand(`${input.value}^C`);
      input.value = "";
      scroll();
    }
  };

  const updateStatus = () => {
    const fill = statusline?.querySelector(".status-fill");
    if (fill) fill.textContent = promptPath();
    if (title) title.textContent = `j3w1@manjaro: ${promptPath()}`;
  };

  const onBufferClick = (event) => {
    if (event.target.closest("a, button")) return;
    if (!window.getSelection()?.toString()) input.focus({ preventScroll: true });
  };
  input.addEventListener("keydown", onKeydown);
  buffer.addEventListener("click", onBufferClick);

  buildTree().then((value) => {
    tree = value;
  });
  updateStatus();

  return {
    focus: () => input.focus({ preventScroll: true }),
    destroy: () => {
      input.removeEventListener("keydown", onKeydown);
      buffer.removeEventListener("click", onBufferClick);
      inputLine.remove();
    },
  };
};
