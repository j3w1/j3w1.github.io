/* Default desktop. The percents match the CSS grid fractions the static site
   uses, so the handoff from fallback layout to window manager is sub-pixel. */

import { makeCon, makeLeaf, normalize } from "./tree.js?v=20260905d";

export const STATE_VERSION = 2;

export const WORKSPACES = Object.freeze([
  "home",
  "writing",
  "projects",
  "photography",
  "books",
  "elsewhere",
  "about",
]);

export const MOBILE_QUERY = "(max-width: 767px)";
export const COARSE_QUERY = "(pointer: coarse)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/* Index 0 is the default: a plain black desktop, with the j3w1-i3 wordmark. */
export const WALLPAPERS = Object.freeze(["black", "ember", "ridge"]);

/* [layout, [[windowId, percent], ...]] */
const LAYOUTS = Object.freeze({
  home: ["splith", [["home-terminal", 0.42], ["home-files", 0.58]]],
  writing: ["splith", [["writing-index", 0.38], ["writing-reader", 0.62]]],
  projects: ["splitv", [["projects-table", 0.58], ["projects-detail", 0.42]]],
  photography: ["splith", [["photography-files", 0.38], ["photography-viewer", 0.62]]],
  books: ["splith", [["books-library", 0.48], ["books-notes", 0.52]]],
  elsewhere: ["splith", [["elsewhere-links", 1]]],
  about: ["tabbed", [["about-editor", 0.5], ["about-interests", 0.5]]],
});

export const defaultWindowIds = () =>
  WORKSPACES.flatMap((name) => LAYOUTS[name][1].map(([id]) => id));

export const homeWorkspaceFor = (id) =>
  WORKSPACES.find((name) => LAYOUTS[name][1].some(([candidate]) => candidate === id)) ?? "home";

const buildWorkspace = (name, { mobile }) => {
  const [layout, windows] = LAYOUTS[name];
  const root = makeCon(mobile && windows.length > 1 ? "tabbed" : layout, []);
  root.children = windows.map(([id, percent]) => makeLeaf(id, percent));
  normalize(root);
  return {
    name,
    root,
    floating: [],
    killed: [],
    focused: windows[0][0],
    fullscreen: null,
    focusMode: "tiling",
    userTouched: false,
  };
};

export const defaultState = ({ mobile = false } = {}) => ({
  version: STATE_VERSION,
  workspaces: Object.fromEntries(
    WORKSPACES.map((name) => [name, buildWorkspace(name, { mobile })]),
  ),
  scratchpad: [],
  scratchpadShown: null,
  wallpaper: WALLPAPERS[0],
});

/* Re-apply the responsive default to any workspace the visitor has not edited. */
export const reapplyResponsiveDefaults = (state, { mobile }) => {
  let changed = false;
  const fresh = defaultState({ mobile });
  for (const name of WORKSPACES) {
    const ws = state.workspaces[name];
    if (!ws || ws.userTouched) continue;
    if (ws.floating.length || ws.killed.length) continue;
    const wanted = fresh.workspaces[name].root.layout;
    if (ws.root.layout === wanted) continue;
    ws.root.layout = wanted;
    changed = true;
  }
  return changed;
};
