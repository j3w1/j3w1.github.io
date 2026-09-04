/* Opt-in console assertions for the pure layout code: open the site with
   ?wm=selftest. Costs nothing when the flag is absent, adds no dependency, and
   mirrors the node test suite so the browser and the CI runner agree. */

import * as tree from "./tree.js?v=20260905b";
import { computeWorkspace, GEOMETRY } from "./layout.js?v=20260905b";
import { defaultState, defaultWindowIds, WORKSPACES } from "./defaults.js?v=20260905b";

const BOUNDS = { x: 0, y: 0, w: 1200, h: 800 };

const workspace = (layout, entries) => {
  const root = tree.makeCon(layout, []);
  root.children = entries.map(([id, percent]) => tree.makeLeaf(id, percent));
  tree.normalize(root);
  return {
    name: "selftest",
    root,
    floating: [],
    killed: [],
    focused: entries[0][0],
    fullscreen: null,
    focusMode: "tiling",
  };
};

export const runSelfTest = () => {
  const results = [];
  const check = (name, run) => {
    try {
      run();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
    }
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  check("tiles cover their parent exactly", () => {
    for (const count of [2, 3, 5]) {
      const ws = workspace("splith", Array.from({ length: count }, (_, i) => [`w${i}`, 1 / count]));
      const result = computeWorkspace(ws, BOUNDS);
      const rects = [...result.tiles.values()];
      rects.forEach((rect, index) => {
        if (!index) return;
        const previous = rects[index - 1];
        assert(rect.x === previous.x + previous.w + GEOMETRY.gapInner, `seam at ${index}`);
      });
      const last = rects[rects.length - 1];
      assert(last.x + last.w === BOUNDS.w, "right edge inexact");
    }
  });

  check("percents stay normalized across every move", () => {
    for (const layout of ["splith", "splitv", "tabbed", "stacked"]) {
      for (const direction of ["left", "right", "up", "down"]) {
        const ws = workspace(layout, [["a", 0.34], ["b", 0.33], ["c", 0.33]]);
        tree.moveLeaf(ws, "b", direction);
        const total = ws.root.children.reduce((sum, child) => sum + child.percent, 0);
        assert(Math.abs(total - 1) < 1e-9, `${layout}/${direction} percents drifted`);
        assert(tree.leafIds(ws.root).length === 3, `${layout}/${direction} lost a window`);
      }
    }
  });

  check("kill then restore returns every window", () => {
    const ws = workspace("splith", [["a", 0.5], ["b", 0.5]]);
    tree.killLeaf(ws, "a");
    assert(ws.focused === "b", "focus was stranded");
    tree.restoreKilled(ws);
    assert(tree.leafIds(ws.root).length === 2, "restore lost a window");
  });

  check("validate reconciles against the live document", () => {
    const state = defaultState({ mobile: false });
    state.workspaces.home.root.children.push(tree.makeLeaf("ghost", 0.2));
    const result = tree.validate(state, defaultWindowIds(), defaultState({ mobile: false }));
    const ids = WORKSPACES.flatMap((name) => tree.leafIds(result.workspaces[name].root));
    assert(!ids.includes("ghost"), "unknown window survived");
    assert(ids.length === defaultWindowIds().length, "window count drifted");
  });

  check("duplicate ids reset to defaults", () => {
    const state = defaultState({ mobile: false });
    state.workspaces.books.root.children.push(tree.makeLeaf("home-terminal", 0.2));
    const defaults = defaultState({ mobile: false });
    assert(tree.validate(state, defaultWindowIds(), defaults) === defaults, "duplicate not caught");
  });

  check("every declared window exists in the document", () => {
    for (const id of defaultWindowIds()) {
      assert(document.querySelector(`[data-wm-window="${id}"]`), `missing window: ${id}`);
    }
  });

  check("content hooks resolve to exactly one element", () => {
    for (const collection of ["writing", "books", "photography"]) {
      assert(
        document.querySelectorAll(`[data-content-list="${collection}"]`).length === 1,
        `${collection} list is not unique`,
      );
      assert(
        document.querySelectorAll(`[data-content-detail="${collection}"]`).length === 1,
        `${collection} detail is not unique`,
      );
    }
  });

  const failed = results.filter((result) => !result.ok);
  results.forEach((result) => {
    if (result.ok) console.log(`%c PASS %c ${result.name}`, "background:#2f7d32;color:#fff", "");
    else console.error(`FAIL ${result.name}: ${result.error}`);
  });
  console.log(`[wm] selftest: ${results.length - failed.length}/${results.length} passed`);
  return failed.length === 0;
};
