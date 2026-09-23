/* Layout persistence. Computed rects and killed windows are deliberately never
   written: a reload always restores a complete desktop, which bounds the worst
   case of any layout experiment to "press F5". */

import { KEYS, storage } from "./session.js?v=20260923";
import { listen } from "./dom.js?v=20260923";
import { STATE_VERSION } from "./defaults.js?v=20260923";

const stripNode = (node) => {
  if (node.type === "win") {
    const plain = { id: node.id, type: "win", percent: node.percent };
    if (node.border) plain.border = node.border;
    if (node.marks?.length) plain.marks = [...node.marks];
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
  wallpaper: state.wallpaper,
  gaps: state.gaps,
  bar: state.bar,
  barLabels: state.barLabels,
  scratchpad: state.scratchpad.map(stripNode),
  scratchpadShown: state.scratchpadShown ?? null,
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
  const raw = storage.read(KEYS.layout, null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.version === STATE_VERSION ? parsed : null;
  } catch {
    return null;
  }
};

/* The layout simply starts from defaults next time. */
export const clear = () => storage.remove(KEYS.layout);

export const createSaver = (getState, delay = 400) => {
  let timer = 0;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = 0;
    /* A quota or private mode fails the write quietly: the desktop still works,
       it just will not persist. */
    let snapshot;
    try {
      snapshot = JSON.stringify(serialize(getState()));
    } catch {
      return;
    }
    storage.write(KEYS.layout, snapshot);
  };

  /* Writes are debounced, so a reload or navigation within the debounce window
     would otherwise silently discard the layout the visitor just arranged. */
  const flushIfPending = () => {
    if (timer) flush();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flushIfPending();
  };
  const cleanup = [
    listen(window, "pagehide", flushIfPending),
    listen(window, "beforeunload", flushIfPending),
    listen(document, "visibilitychange", onVisibility),
  ];

  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };
  save.flush = flush;
  save.destroy = () => {
    flushIfPending();
    for (const remove of cleanup) remove();
  };
  return save;
};
