/* Layout persistence. Computed rects and killed windows are deliberately never
   written: a reload always restores a complete desktop, which bounds the worst
   case of any layout experiment to "press F5". */

import { KEYS } from "./session.js?v=20260905b";
import { STATE_VERSION } from "./defaults.js?v=20260905b";

const stripNode = (node) => {
  if (node.type === "win") {
    const plain = { id: node.id, type: "win", percent: node.percent };
    if (node.floating) {
      plain.floating = true;
      if (node.floatRect) plain.floatRect = { ...node.floatRect };
    }
    if (node.spawned) plain.spawned = true;
    return plain;
  }
  return {
    id: node.id,
    type: "con",
    layout: node.layout,
    percent: node.percent,
    focus: node.focus ?? 0,
    children: node.children.map(stripNode),
  };
};

export const serialize = (state) => ({
  version: STATE_VERSION,
  modPreference: state.modPreference,
  wallpaper: state.wallpaper,
  scratchpad: state.scratchpad.map(stripNode),
  workspaces: Object.fromEntries(
    Object.entries(state.workspaces).map(([name, ws]) => [
      name,
      {
        name,
        root: stripNode(ws.root),
        floating: ws.floating.map(stripNode),
        focused: ws.focused,
        focusMode: ws.focusMode,
        userTouched: Boolean(ws.userTouched),
      },
    ]),
  ),
});

export const load = () => {
  try {
    const raw = localStorage.getItem(KEYS.layout);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== STATE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const clear = () => {
  try {
    localStorage.removeItem(KEYS.layout);
  } catch {
    /* nothing to do: the layout simply starts from defaults next time */
  }
};

export const createSaver = (getState, delay = 400) => {
  let timer = 0;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = 0;
    try {
      localStorage.setItem(KEYS.layout, JSON.stringify(serialize(getState())));
    } catch {
      /* quota or private mode: the desktop still works, it just will not persist */
    }
  };

  /* Writes are debounced, so a reload or navigation within the debounce window
     would otherwise silently discard the layout the visitor just arranged. */
  const flushIfPending = () => {
    if (timer) flush();
  };
  addEventListener("pagehide", flushIfPending);
  addEventListener("beforeunload", flushIfPending);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushIfPending();
  });

  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };
  save.flush = flush;
  return save;
};
