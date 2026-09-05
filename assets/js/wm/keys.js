/* Keybindings and binding modes.

   i3's $mod is Alt, but browsers reserve most Alt combinations (Alt+D focuses
   the address bar, Alt+Left is history back, Alt+digit switches tabs in some
   Linux builds). So bare keys are the primary scheme — extending the site's
   existing 1-7 / hjkl / ? bindings — and Alt+<letter> is accepted as an alias
   wherever the browser allows it. Bindings that genuinely need a modifier to
   avoid breaking the page (Space would kill space-to-scroll) are Alt-only.

   Modes are i3 binding modes: `resize`, and the three the original
   workstation's config defined — the system menu on 0, and the gaps modes on
   Shift+G. Each mode is a table; the bar shows the mode's prompt verbatim. */

import { isEditable } from "./dom.js?v=20260905i";
import { announce } from "./a11y.js?v=20260905i";

const DIRECTIONS = Object.freeze({
  h: "left",
  j: "down",
  k: "up",
  l: "right",
  ArrowLeft: "left",
  ArrowDown: "down",
  ArrowUp: "up",
  ArrowRight: "right",
});

/* The prompt i3 shows in the bar for each mode, from the original config. */
export const MODE_PROMPTS = Object.freeze({
  resize: "resize",
  system: "(l)ock, (e)xit, switch_(u)ser, (s)uspend, (h)ibernate, (r)eboot, (Shift+s)hutdown",
  gaps: "Gaps: (o) outer, (i) inner",
  "gaps inner": "Inner Gaps: +|-|0 (local), Shift + +|-|0 (global)",
  "gaps outer": "Outer Gaps: +|-|0 (local), Shift + +|-|0 (global)",
});

const key = (value) => (event) => event.key === value && !event.altKey;
const shifted = (value) => (event) => event.key === value && event.shiftKey;
const leave = (setMode) => ({
  keys: "Escape / Enter",
  description: "leave the mode",
  test: (event) => ["Escape", "Enter"].includes(event.key),
  run: () => setMode("default"),
});

export const installKeys = ({ wm, isBlocked, onWorkspaceRequest, openLauncher }) => {
  let mode = "default";

  const setMode = (next) => {
    if (!(next === "default" || next in MODE_PROMPTS)) return false;
    if (mode === next) return true;
    mode = next;
    wm.onModeChange?.(mode, MODE_PROMPTS[mode] ?? "");
    announce(next === "default" ? "default mode" : `${next} mode`);
    return true;
  };

  const bindings = [
    {
      keys: "1 – 7",
      description: "switch workspace (the same number again goes back)",
      test: (event) => /^Digit[1-7]$/.test(event.code) && !event.shiftKey && !event.ctrlKey,
      run: (event) => wm.requestWorkspace(Number(event.code.slice(5))),
    },
    {
      keys: "Alt + Shift + 1 – 7",
      description: "move window to workspace and follow it",
      altOnly: true,
      test: (event) => /^Digit[1-7]$/.test(event.code) && event.shiftKey && event.altKey && !event.ctrlKey,
      run: (event) => wm.moveToWorkspaceIndex(Number(event.code.slice(5)), { follow: true }),
    },
    {
      keys: "Ctrl + Alt + 1 – 7",
      description: "move window to workspace, stay here",
      altOnly: true,
      test: (event) => /^Digit[1-7]$/.test(event.code) && event.ctrlKey && event.altKey,
      run: (event) => wm.moveToWorkspaceIndex(Number(event.code.slice(5))),
    },
    {
      keys: "h j k l / arrows",
      description: "focus left, down, up, right",
      test: (event) => !event.shiftKey && !event.ctrlKey && DIRECTIONS[event.key] !== undefined,
      run: (event) => wm.focus(DIRECTIONS[event.key]),
    },
    {
      keys: "H J K L",
      description: "move the focused window",
      test: (event) => event.shiftKey && DIRECTIONS[event.key.toLowerCase()] !== undefined && event.key.length === 1,
      run: (event) => wm.move(DIRECTIONS[event.key.toLowerCase()]),
    },
    {
      keys: "Ctrl + ← / →",
      description: "previous / next workspace",
      test: (event) => event.ctrlKey && !event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight"),
      run: (event) => wm.stepWorkspace(event.key === "ArrowRight" ? 1 : -1),
    },
    { keys: "`", description: "workspace back and forth", test: key("`"), run: () => wm.workspaceBackAndForth() },
    { keys: "~", description: "move window to the previous workspace", test: shifted("~"), run: () => wm.moveToWorkspaceBackAndForth() },
    { keys: "a", description: "focus the parent container", test: key("a"), run: () => wm.focusParent() },
    { keys: "b", description: "split horizontally", test: key("b"), run: () => wm.split("h") },
    { keys: "v", description: "split vertically", test: key("v"), run: () => wm.split("v") },
    { keys: "w", description: "tabbed layout", test: key("w"), run: () => wm.setLayout("tabbed") },
    { keys: "s", description: "stacked layout", test: key("s"), run: () => wm.setLayout("stacked") },
    { keys: "e", description: "toggle split layout", test: key("e"), run: () => wm.toggleSplit() },
    { keys: "f", description: "fullscreen the focused window", test: key("f"), run: () => wm.toggleFullscreen() },
    { keys: "q / Shift + Q", description: "close the focused window", test: (e) => (e.key === "q" || e.key === "Q") && !e.altKey, run: () => wm.kill() },
    { keys: "u / y / n", description: "border none / pixel / normal", test: (e) => ["u", "y", "n"].includes(e.key) && !e.altKey, run: (e) => wm.setBorder({ u: "none", y: "pixel", n: "normal" }[e.key]) },
    { keys: "Shift + S", description: "sticky: show a floating window on every workspace", test: shifted("S"), run: () => wm.setSticky("toggle") },
    { keys: "m", description: "hide or show the bar", test: key("m"), run: () => wm.setBarMode("toggle") },
    { keys: "Ctrl + Space", description: "close every notification", test: (e) => e.code === "Space" && e.ctrlKey, run: () => wm.closeNotifications() },
    {
      keys: "Shift + R",
      description: "restart in place: default layout, every window back",
      test: shifted("R"),
      run: () => wm.restart(),
    },
    { keys: "Shift + C", description: "reload the configuration", test: shifted("C"), run: () => wm.reload() },
    {
      keys: "Shift + E",
      description: "session menu: lock, log out, restart i3, reboot, shut down",
      test: shifted("E"),
      run: () => wm.togglePowerMenu(),
    },
    { keys: "0", description: "system mode: lock, exit, switch user, suspend, hibernate, reboot, shutdown", test: (e) => e.code === "Digit0" && !e.shiftKey && !e.ctrlKey, run: () => setMode("system") },
    { keys: "r", description: "resize mode", test: key("r"), run: () => setMode("resize") },
    { keys: "Shift + G", description: "gaps mode", test: shifted("G"), run: () => setMode("gaps") },
    { keys: "d", description: "open dmenu", test: key("d"), run: () => openLauncher(":") },
    {
      keys: "Alt + Space",
      description: "switch focus between tiling and floating",
      altOnly: true,
      test: (event) => event.code === "Space" && event.altKey && !event.shiftKey,
      run: () => wm.toggleFocusMode(),
    },
    {
      keys: "Alt + Shift + Space",
      description: "float or unfloat the focused window",
      altOnly: true,
      test: (event) => event.code === "Space" && event.altKey && event.shiftKey,
      run: () => wm.toggleFloating(),
    },
    { keys: "−", description: "show or hide the scratchpad (cycles)", test: (e) => e.key === "-", run: () => wm.scratchpadShow() },
    { keys: "_", description: "move the focused window to the scratchpad", test: (e) => e.key === "_", run: () => wm.scratchpadMove() },
    {
      keys: "Alt + Enter",
      description: "open a terminal (plain Enter when the workspace is empty)",
      test: (event) => event.key === "Enter" && (event.altKey || wm.activeIsEmpty()),
      run: () => wm.spawn("urxvt"),
    },
  ];

  const resizeBindings = [
    {
      keys: "h j k l / arrows",
      description: "resize the focused window (hold Shift for larger steps)",
      test: (event) => DIRECTIONS[event.key] !== undefined,
      run: (event) => wm.resize(DIRECTIONS[event.key], event.shiftKey ? 10 : 5),
    },
    {
      keys: "Escape / Enter / r",
      description: "leave resize mode",
      test: (event) => ["Escape", "Enter"].includes(event.key) || event.key === "r",
      run: () => setMode("default"),
    },
  ];

  /* i3exit, one key per action, exactly as the original config bound them. */
  const systemBindings = [
    ...[["l", "lock"], ["e", "exit"], ["u", "switch_user"], ["s", "suspend"], ["h", "hibernate"], ["r", "reboot"]].map(([letter, action]) => ({
      keys: letter,
      description: action.replace("_", " "),
      test: (event) => event.key === letter,
      run: () => {
        setMode("default");
        wm.power(action);
      },
    })),
    { keys: "Shift + S", description: "shutdown", test: shifted("S"), run: () => { setMode("default"); wm.power("shutdown"); } },
    leave(setMode),
  ];

  const gapsBindings = [
    { keys: "o", description: "outer gaps", test: key("o"), run: () => setMode("gaps outer") },
    { keys: "i", description: "inner gaps", test: key("i"), run: () => setMode("gaps inner") },
    leave(setMode),
  ];
  const gapsAxisBindings = (which) => [
    { keys: "+ / −", description: `${which} gaps larger or smaller`, test: (e) => ["+", "=", "-", "_"].includes(e.key), run: (e) => wm.gaps([which, "all", ["+", "="].includes(e.key) ? "plus" : "minus", "5"]) },
    { keys: "0", description: `${which} gaps off`, test: (e) => e.key === "0" || e.key === ")", run: () => wm.gaps([which, "all", "set", "0"]) },
    leave(setMode),
  ];

  const modes = {
    resize: resizeBindings,
    system: systemBindings,
    gaps: gapsBindings,
    "gaps inner": gapsAxisBindings("inner"),
    "gaps outer": gapsAxisBindings("outer"),
  };

  const onKeydown = (event) => {
    if (event.defaultPrevented || isBlocked()) return;
    if (event.metaKey) return;
    /* Ctrl is the browser's, except the two workspace-stepping arrows and the
       Ctrl+Alt+digit moves, which collide with nothing outside an editable field. */
    if (event.ctrlKey && !(event.key === "ArrowLeft" || event.key === "ArrowRight" || event.code === "Space") && !(event.altKey && /^Digit[1-7]$/.test(event.code))) return;
    if (isEditable(event.target)) return;

    if (mode !== "default") {
      for (const binding of modes[mode]) {
        if (!binding.test(event)) continue;
        event.preventDefault();
        binding.run(event);
        /* One Escape leaves both the mode and fullscreen; a silent first press
           that only left the mode read as the key not working. */
        if (event.key === "Escape") wm.exitFullscreen();
        return;
      }
      return;
    }

    if (event.key === "Escape" && wm.exitFullscreen()) {
      event.preventDefault();
      return;
    }

    for (const binding of bindings) {
      if (binding.altOnly && !event.altKey) continue;
      if (!binding.test(event)) continue;
      /* Arrow keys only steer the window manager when a window already has focus,
         so ordinary browser scrolling and caret movement are left alone. */
      if (event.key.startsWith("Arrow") && !event.ctrlKey && !document.activeElement?.closest?.("[data-wm-window]")) continue;
      event.preventDefault();
      binding.run(event);
      return;
    }
  };

  document.addEventListener("keydown", onKeydown);

  const describe = (list) => list.map(({ keys, description }) => ({ keys, description }));

  return {
    setMode,
    getMode: () => mode,
    bindings: () => [
      ...describe(bindings),
      { keys: "?", description: "show this help" },
      { keys: "/ or :", description: "open the command launcher" },
      { keys: "Escape", description: "leave fullscreen, or close an overlay" },
      { keys: "Tab", description: "ordinary browser focus navigation" },
    ],
    resizeBindings: () => describe(resizeBindings),
    modeBindings: () => Object.fromEntries(Object.entries(modes).map(([name, list]) => [name, describe(list)])),
    destroy: () => document.removeEventListener("keydown", onKeydown),
  };
};
