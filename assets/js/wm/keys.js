/* Keybindings and binding modes.

   i3's $mod is Alt, but browsers reserve most Alt combinations (Alt+D focuses
   the address bar, Alt+Left is history back, Alt+digit switches tabs in some
   Linux builds). So bare keys are the primary scheme — extending the site's
   existing 1-7 / hjkl / ? bindings — and Alt+<letter> is accepted as an alias
   wherever the browser allows it. Bindings that genuinely need a modifier to
   avoid breaking the page (Space would kill space-to-scroll) are Alt-only. */

import { isEditable } from "./dom.js?v=20260905";
import { announce } from "./a11y.js?v=20260905";

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

export const installKeys = ({ wm, isBlocked, onWorkspaceRequest, openLauncher }) => {
  let mode = "default";

  const setMode = (next) => {
    if (mode === next) return;
    mode = next;
    wm.onModeChange?.(mode);
    announce(next === "default" ? "default mode" : `${next} mode`);
  };

  const bindings = [
    {
      keys: "1 – 7",
      description: "switch workspace",
      test: (event) => /^Digit[1-7]$/.test(event.code) && !event.shiftKey,
      run: (event) => onWorkspaceRequest(Number(event.code.slice(5))),
    },
    {
      keys: "Alt + Shift + 1 – 7",
      description: "move window to workspace",
      altOnly: true,
      test: (event) => /^Digit[1-7]$/.test(event.code) && event.shiftKey && event.altKey,
      run: (event) => wm.moveToWorkspaceIndex(Number(event.code.slice(5))),
    },
    {
      keys: "h j k l / arrows",
      description: "focus left, down, up, right",
      test: (event) => !event.shiftKey && DIRECTIONS[event.key] !== undefined,
      run: (event) => wm.focus(DIRECTIONS[event.key]),
    },
    {
      keys: "H J K L",
      description: "move the focused window",
      test: (event) => event.shiftKey && DIRECTIONS[event.key.toLowerCase()] !== undefined &&
        event.key.length === 1,
      run: (event) => wm.move(DIRECTIONS[event.key.toLowerCase()]),
    },
    { keys: "b", description: "split horizontally", test: (e) => e.key === "b", run: () => wm.split("h") },
    { keys: "v", description: "split vertically", test: (e) => e.key === "v", run: () => wm.split("v") },
    { keys: "w", description: "tabbed layout", test: (e) => e.key === "w", run: () => wm.setLayout("tabbed") },
    { keys: "s", description: "stacked layout", test: (e) => e.key === "s", run: () => wm.setLayout("stacked") },
    { keys: "e", description: "toggle split layout", test: (e) => e.key === "e", run: () => wm.toggleSplit() },
    { keys: "f", description: "fullscreen the focused window", test: (e) => e.key === "f", run: () => wm.toggleFullscreen() },
    { keys: "q", description: "close the focused window", test: (e) => e.key === "q", run: () => wm.kill() },
    {
      keys: "Shift + R",
      description: "restart in place: default layout, every window back",
      test: (event) => event.key === "R" && event.shiftKey,
      run: () => wm.restart(),
    },
    {
      keys: "Shift + E",
      description: "session menu: lock, log out, restart i3",
      test: (event) => event.key === "E" && event.shiftKey,
      run: () => wm.togglePowerMenu(),
    },
    { keys: "r", description: "resize mode", test: (e) => e.key === "r", run: () => setMode("resize") },
    { keys: "d", description: "open dmenu", test: (e) => e.key === "d", run: () => openLauncher(":") },
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
    { keys: "−", description: "show or hide the scratchpad", test: (e) => e.key === "-", run: () => wm.scratchpadShow() },
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

  const onKeydown = (event) => {
    if (event.defaultPrevented || isBlocked()) return;
    if (event.ctrlKey || event.metaKey) return;
    if (isEditable(event.target)) return;

    if (mode === "resize") {
      for (const binding of resizeBindings) {
        if (!binding.test(event)) continue;
        event.preventDefault();
        binding.run(event);
        return;
      }
      return;
    }

    if (event.key === "Escape" && wm.exitFullscreen()) {
      event.preventDefault();
      return;
    }

    const bare = !event.altKey;
    for (const binding of bindings) {
      if (binding.altOnly && !event.altKey) continue;
      if (bare && wm.modPreference() === "alt" && !binding.altOnly) continue;
      if (!binding.test(event)) continue;
      /* Arrow keys only steer the window manager when a window already has focus,
         so ordinary browser scrolling and caret movement are left alone. */
      if (event.key.startsWith("Arrow") && !document.activeElement?.closest?.("[data-wm-window]")) continue;
      event.preventDefault();
      binding.run(event);
      return;
    }
  };

  document.addEventListener("keydown", onKeydown);

  return {
    setMode,
    getMode: () => mode,
    bindings: () => [
      ...bindings.map(({ keys, description }) => ({ keys, description })),
      { keys: "?", description: "show this help" },
      { keys: "/ or :", description: "open the command launcher" },
      { keys: "Escape", description: "leave fullscreen, or close an overlay" },
      { keys: "Tab", description: "ordinary browser focus navigation" },
    ],
    resizeBindings: () => resizeBindings.map(({ keys, description }) => ({ keys, description })),
    destroy: () => document.removeEventListener("keydown", onKeydown),
  };
};
