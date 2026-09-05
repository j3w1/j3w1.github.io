import assert from "node:assert/strict";
import test from "node:test";

import {
  allIds,
  axisOf,
  findLeaf,
  killLeaf,
  leafIds,
  makeCon,
  makeLeaf,
  moveToScratchpad,
  moveLeaf,
  moveToWorkspace,
  normalize,
  resizeLeaf,
  restoreKilled,
  setFocus,
  setLayout,
  showScratchpad,
  split,
  toggleFloating,
  toggleFullscreen,
  toggleSplit,
  validate,
} from "../assets/js/wm/tree.js";
import { computeWorkspace, GEOMETRY } from "../assets/js/wm/layout.js";
import { defaultState, defaultWindowIds, WORKSPACES } from "../assets/js/wm/defaults.js";

const workspace = (layout, entries) => {
  const root = makeCon(layout, []);
  root.children = entries.map(([id, percent]) => makeLeaf(id, percent));
  normalize(root);
  return {
    name: "test",
    root,
    floating: [],
    killed: [],
    focused: entries[0][0],
    fullscreen: null,
    focusMode: "tiling",
    userTouched: false,
  };
};

const BOUNDS = { x: 0, y: 0, w: 1200, h: 800 };

const sumPercents = (con) => con.children.reduce((total, child) => total + child.percent, 0);

test("axis mapping follows i3: splith/tabbed horizontal, splitv/stacked vertical", () => {
  assert.equal(axisOf("splith"), "h");
  assert.equal(axisOf("tabbed"), "h");
  assert.equal(axisOf("splitv"), "v");
  assert.equal(axisOf("stacked"), "v");
});

test("normalize renormalizes percents, collapses single-child containers, drops empties", () => {
  const inner = makeCon("splitv", [makeLeaf("only", 1)], 0.5);
  const root = makeCon("splith", [makeLeaf("a", 2), inner, makeCon("splitv", [], 0.25)]);
  normalize(root);
  assert.equal(root.children.length, 2);
  assert.ok(root.children.every((child) => child.type === "win"));
  assert.ok(Math.abs(sumPercents(root) - 1) < 1e-9);
});

/* i3-gaps: with more than one tile the workspace is inset by the outer gap
   (inner + outer) before the tiles are laid out. */
const EDGE = GEOMETRY.gapInner + GEOMETRY.gapOuter;

test("tiles exactly cover their parent with no seams or overlaps", () => {
  for (const count of [2, 3, 5, 7]) {
    const entries = Array.from({ length: count }, (_, index) => [`w${index}`, 1 / count]);
    const ws = workspace("splith", entries);
    const result = computeWorkspace(ws, BOUNDS);
    const rects = entries.map(([id]) => result.tiles.get(id));
    rects.forEach((rect, index) => {
      assert.ok(rect.w > 0 && rect.h > 0, `w${index} has positive size`);
      if (index === 0) return;
      const previous = rects[index - 1];
      assert.equal(rect.x, previous.x + previous.w + GEOMETRY.gapInner, "abuts across the gap");
    });
    assert.equal(rects[0].x, BOUNDS.x + EDGE, "left edge is the outer gap");
    const last = rects[rects.length - 1];
    assert.equal(last.x + last.w, BOUNDS.x + BOUNDS.w - EDGE, "right edge is exact");
    assert.equal(result.gutters.length, count - 1);
  }
});

test("vertical splits tile exactly too", () => {
  const ws = workspace("splitv", [["a", 0.58], ["b", 0.42]]);
  const result = computeWorkspace(ws, BOUNDS);
  const a = result.tiles.get("a");
  const b = result.tiles.get("b");
  assert.equal(a.y, EDGE);
  assert.equal(b.y, a.y + a.h + GEOMETRY.gapInner);
  assert.equal(b.y + b.h, BOUNDS.h - EDGE);
});

test("smart_gaps: a lone tile fills the workspace with no gap at all", () => {
  const ws = workspace("splith", [["only", 1]]);
  const result = computeWorkspace(ws, BOUNDS, { ...GEOMETRY, gapInner: 14, gapOuter: -2 });
  assert.deepEqual(result.tiles.get("only"), { ...BOUNDS });
  assert.equal(result.smart, true);
  /* A single nested container is still one child of the workspace. */
  const nested = workspace("splith", [["a", 0.5], ["b", 0.5]]);
  split(nested, "a", "v");
  const nestedResult = computeWorkspace(nested, BOUNDS, { ...GEOMETRY, gapInner: 14, gapOuter: -2 });
  assert.equal(nestedResult.smart, nested.root.children.length <= 1);
  const two = computeWorkspace(workspace("splith", [["a", 0.5], ["b", 0.5]]), BOUNDS, { ...GEOMETRY, gapInner: 14, gapOuter: -2 });
  assert.equal(two.tiles.get("a").x, BOUNDS.x + 12, "inner 14 + outer -2 = 12 at the edge");
  assert.equal(two.tiles.get("b").x - (two.tiles.get("a").x + two.tiles.get("a").w), 14, "14 between tiles");
  assert.equal(two.smart, false);
});

test("tabbed containers show only the focused child and emit one tab per child", () => {
  const ws = workspace("tabbed", [["a", 0.5], ["b", 0.5]]);
  const result = computeWorkspace(ws, BOUNDS);
  assert.ok(result.tiles.has("a"));
  assert.ok(result.hidden.has("b"));
  assert.equal(result.decos.length, 1);
  assert.equal(result.decos[0].kind, "tabbed");
  assert.equal(result.decos[0].tabs.length, 2);
  assert.equal(result.decos[0].tabs[0].active, true);
  assert.equal(result.tiles.get("a").h, BOUNDS.h - GEOMETRY.tabHeight - EDGE * 2);
  const [first, second] = result.decos[0].tabs;
  assert.equal(first.rect.x + first.rect.w, second.rect.x, "tabs abut");
  assert.equal(second.rect.x + second.rect.w, BOUNDS.w - EDGE, "tab strip spans the width inside the outer gap");
});

test("stacked containers reserve one row per child", () => {
  const ws = workspace("stacked", [["a", 0.5], ["b", 0.5], ["c", 0.5]]);
  const result = computeWorkspace(ws, BOUNDS);
  assert.equal(result.decos[0].kind, "stacked");
  assert.equal(result.tiles.get("a").h, BOUNDS.h - GEOMETRY.stackRow * 3 - EDGE * 2);
  assert.ok(result.hidden.has("b") && result.hidden.has("c"));
});

test("fullscreen gives one window the whole workspace and hides the rest", () => {
  const ws = workspace("splith", [["a", 0.5], ["b", 0.5]]);
  toggleFullscreen(ws, "b");
  const result = computeWorkspace(ws, BOUNDS);
  assert.deepEqual(result.tiles.get("b"), { ...BOUNDS });
  assert.ok(result.hidden.has("a"));
  assert.equal(result.gutters.length, 0);
  toggleFullscreen(ws, "b");
  assert.equal(ws.fullscreen, null);
});

test("moveLeaf swaps siblings along a matching axis", () => {
  const ws = workspace("splith", [["a", 0.4], ["b", 0.6]]);
  assert.equal(moveLeaf(ws, "a", "right"), true);
  assert.deepEqual(leafIds(ws.root), ["b", "a"]);
  assert.equal(ws.focused, "a");
  assert.ok(Math.abs(sumPercents(ws.root) - 1) < 1e-9);
});

test("moveLeaf refuses to move past the edge of a matching-axis root", () => {
  const ws = workspace("splith", [["a", 0.5], ["b", 0.5]]);
  assert.equal(moveLeaf(ws, "a", "left"), false);
  assert.deepEqual(leafIds(ws.root), ["a", "b"]);
});

test("moveLeaf wraps the root when no ancestor shares the axis", () => {
  const ws = workspace("splith", [["a", 0.5], ["b", 0.5]]);
  assert.equal(moveLeaf(ws, "a", "up"), true);
  assert.equal(axisOf(ws.root.layout), "v");
  assert.equal(leafIds(ws.root)[0], "a");
  assert.equal(ws.root.children.length, 2);
  assert.ok(Math.abs(sumPercents(ws.root) - 1) < 1e-9);
});

test("moveLeaf descends into a sibling container at the near edge", () => {
  const nested = makeCon("splitv", [makeLeaf("b", 0.5), makeLeaf("c", 0.5)], 0.5);
  const root = makeCon("splith", [makeLeaf("a", 0.5), nested]);
  normalize(root);
  const ws = { name: "t", root, floating: [], killed: [], focused: "a", fullscreen: null, focusMode: "tiling" };
  assert.equal(moveLeaf(ws, "a", "right"), true);
  assert.deepEqual(leafIds(ws.root), ["a", "b", "c"]);
  assert.equal(ws.root.children.length, 1, "root collapsed onto the nested container");
});

test("moveLeaf covers every direction and layout without corrupting the tree", () => {
  for (const layout of ["splith", "splitv", "tabbed", "stacked"]) {
    for (const direction of ["left", "right", "up", "down"]) {
      const ws = workspace(layout, [["a", 0.34], ["b", 0.33], ["c", 0.33]]);
      moveLeaf(ws, "b", direction);
      assert.deepEqual([...leafIds(ws.root)].sort(), ["a", "b", "c"], `${layout}/${direction} keeps every window`);
      assert.ok(Math.abs(sumPercents(ws.root) - 1) < 1e-9, `${layout}/${direction} keeps percents normalized`);
      const result = computeWorkspace(ws, BOUNDS);
      assert.equal(result.tiles.size + result.hidden.size, 3);
    }
  }
});

test("split nests the focused leaf with a sibling and preserves their combined share", () => {
  const ws = workspace("splith", [["a", 0.5], ["b", 0.3], ["c", 0.2]]);
  assert.equal(split(ws, "a", "v"), true);
  assert.equal(ws.root.children.length, 2);
  const nested = ws.root.children[0];
  assert.equal(nested.type, "con");
  assert.equal(nested.layout, "splitv");
  assert.ok(Math.abs(nested.percent - 0.8) < 1e-9);
  assert.deepEqual(leafIds(ws.root), ["a", "b", "c"]);
});

test("split on a single-child container just sets the orientation", () => {
  const ws = workspace("splith", [["a", 1]]);
  assert.equal(split(ws, "a", "v"), true);
  assert.equal(ws.root.layout, "splitv");
  assert.equal(ws.root.children.length, 1);
});

test("setLayout and toggleSplit act on the focused window's parent", () => {
  const ws = workspace("splith", [["a", 0.5], ["b", 0.5]]);
  assert.equal(setLayout(ws, "a", "tabbed"), true);
  assert.equal(ws.root.layout, "tabbed");
  setLayout(ws, "a", "splith");
  toggleSplit(ws, "a");
  assert.equal(ws.root.layout, "splitv");
});

test("resizeLeaf moves share between neighbours and respects the minimum", () => {
  const ws = workspace("splith", [["a", 0.5], ["b", 0.5]]);
  assert.equal(resizeLeaf(ws, "a", "right", 10), true);
  assert.ok(Math.abs(ws.root.children[0].percent - 0.6) < 1e-9);
  assert.ok(Math.abs(sumPercents(ws.root) - 1) < 1e-9);
  for (let step = 0; step < 40; step += 1) resizeLeaf(ws, "b", "right", 10);
  assert.ok(ws.root.children.every((child) => child.percent >= 0.07), "never collapses a neighbour");
});

test("resizeLeaf is a no-op inside tabbed and stacked containers", () => {
  for (const layout of ["tabbed", "stacked"]) {
    const ws = workspace(layout, [["a", 0.5], ["b", 0.5]]);
    assert.equal(resizeLeaf(ws, "a", "right", 10), false);
  }
});

test("floating round-trips through the tree and clamps into bounds", () => {
  const ws = workspace("splith", [["a", 0.5], ["b", 0.5]]);
  computeWorkspace(ws, BOUNDS);
  assert.equal(toggleFloating(ws, "a", BOUNDS), true);
  assert.equal(ws.floating.length, 1);
  assert.equal(leafIds(ws.root).includes("a"), false);
  ws.floating[0].floatRect = { x: 100000, y: 100000, w: 400, h: 300 };
  const result = computeWorkspace(ws, BOUNDS);
  const rect = result.floats.get("a");
  assert.ok(rect.x < BOUNDS.w, "kept on screen horizontally");
  assert.ok(rect.y < BOUNDS.h, "kept on screen vertically");
  assert.equal(toggleFloating(ws, "a", BOUNDS), true);
  assert.ok(leafIds(ws.root).includes("a"));
  assert.equal(ws.floating.length, 0);
});

test("kill hides a window, keeps it restorable, and never strands focus", () => {
  const ws = workspace("splith", [["a", 0.5], ["b", 0.5]]);
  setFocus(ws, "a");
  killLeaf(ws, "a");
  assert.deepEqual(ws.killed, ["a"]);
  assert.equal(leafIds(ws.root).includes("a"), false);
  assert.equal(ws.focused, "b", "focus moved to a live window");
  assert.equal(restoreKilled(ws), true);
  assert.deepEqual([...leafIds(ws.root)].sort(), ["a", "b"]);
  assert.deepEqual(ws.killed, []);
});

test("killing every window leaves an empty workspace rather than a broken tree", () => {
  const ws = workspace("splith", [["a", 0.5], ["b", 0.5]]);
  killLeaf(ws, "a");
  killLeaf(ws, "b");
  assert.equal(leafIds(ws.root).length, 0);
  assert.equal(ws.focused, null);
  const result = computeWorkspace(ws, BOUNDS);
  assert.equal(result.tiles.size, 0);
  restoreKilled(ws);
  assert.equal(leafIds(ws.root).length, 2);
});

test("moveToWorkspace transfers a window between workspaces exactly once", () => {
  const state = defaultState({ mobile: false });
  assert.equal(moveToWorkspace(state, "home-terminal", "home", "books"), true);
  assert.equal(leafIds(state.workspaces.home.root).includes("home-terminal"), false);
  assert.ok(leafIds(state.workspaces.books.root).includes("home-terminal"));
  const everything = WORKSPACES.flatMap((name) => allIds(state.workspaces[name]));
  assert.equal(new Set(everything).size, everything.length, "no duplicates across workspaces");
});

test("default state covers every workspace and window, and goes tabbed on mobile", () => {
  const desktop = defaultState({ mobile: false });
  assert.deepEqual(Object.keys(desktop.workspaces), [...WORKSPACES]);
  const ids = WORKSPACES.flatMap((name) => leafIds(desktop.workspaces[name].root));
  assert.deepEqual([...ids].sort(), [...defaultWindowIds()].sort());
  assert.equal(desktop.workspaces.home.root.layout, "splith");
  assert.equal(desktop.workspaces.about.root.layout, "tabbed");

  const mobile = defaultState({ mobile: true });
  for (const name of WORKSPACES) {
    const ws = mobile.workspaces[name];
    if (leafIds(ws.root).length > 1) assert.equal(ws.root.layout, "tabbed", `${name} is tabbed on mobile`);
  }
});

test("validate drops unknown windows and adopts live ones that are missing", () => {
  const state = defaultState({ mobile: false });
  state.workspaces.home.root.children.push(makeLeaf("ghost-window", 0.2));
  normalize(state.workspaces.home.root);
  const live = defaultWindowIds();
  const result = validate(state, live, defaultState({ mobile: false }));
  const ids = WORKSPACES.flatMap((name) => leafIds(result.workspaces[name].root));
  assert.equal(ids.includes("ghost-window"), false, "unknown window dropped");
  assert.deepEqual([...ids].sort(), [...live].sort(), "every live window placed exactly once");
});

test("validate resets to defaults when a window appears twice", () => {
  const state = defaultState({ mobile: false });
  state.workspaces.books.root.children.push(makeLeaf("home-terminal", 0.2));
  normalize(state.workspaces.books.root);
  const fallback = defaultState({ mobile: false });
  const result = validate(state, defaultWindowIds(), fallback);
  assert.equal(result, fallback, "duplicate id forces a full reset");
});

test("validate survives corrupt input without throwing", () => {
  const fallback = defaultState({ mobile: false });
  for (const corrupt of [null, undefined, 42, "nonsense", {}, { workspaces: null }, { workspaces: { home: {} } }]) {
    assert.doesNotThrow(() => validate(corrupt, defaultWindowIds(), fallback));
  }
});

test("validate never persists killed windows, so a reload restores the desktop", () => {
  const state = defaultState({ mobile: false });
  killLeaf(state.workspaces.home, "home-terminal");
  const result = validate(state, defaultWindowIds(), defaultState({ mobile: false }));
  assert.deepEqual(result.workspaces.home.killed, []);
  assert.ok(leafIds(result.workspaces.home.root).includes("home-terminal"));
});

test("focus bookkeeping points at a real window after every structural change", () => {
  const state = defaultState({ mobile: false });
  const ws = state.workspaces.home;
  const operations = [
    () => split(ws, ws.focused, "v"),
    () => moveLeaf(ws, ws.focused, "down"),
    () => setLayout(ws, ws.focused, "stacked"),
    () => toggleFloating(ws, ws.focused, BOUNDS),
    () => toggleFullscreen(ws, ws.focused),
  ];
  for (const operate of operations) {
    operate();
    if (ws.focused === null) continue;
    const live = allIds(ws);
    assert.ok(live.includes(ws.focused), "focused window still exists");
    assert.ok(findLeaf(ws.root, ws.focused) || ws.floating.some((n) => n.id === ws.focused));
  }
});

test("scratchpad show cycles through every scratchpad window, i3-style", () => {
  const state = defaultState({ mobile: false });
  const ws = state.workspaces.home;
  const bounds = { x: 0, y: 0, w: 1200, h: 800 };
  const [first, second] = leafIds(ws.root);
  assert.ok(moveToScratchpad(state, ws, first));
  assert.ok(moveToScratchpad(state, ws, second));
  assert.deepEqual(state.scratchpad.map((node) => node.id), [first, second]);

  assert.ok(showScratchpad(state, ws, bounds), "shows the first window");
  assert.equal(state.scratchpadShown, first);
  assert.equal(ws.focused, first);
  assert.ok(showScratchpad(state, ws, bounds), "hides the focused shown window and queues it last");
  assert.equal(state.scratchpadShown, null);
  assert.deepEqual(state.scratchpad.map((node) => node.id), [second, first]);
  assert.ok(showScratchpad(state, ws, bounds), "the next press shows the other window");
  assert.equal(state.scratchpadShown, second);

  /* Visible but unfocused: show focuses it instead of hiding it. */
  ws.focused = leafIds(ws.root)[0] ?? null;
  assert.ok(showScratchpad(state, ws, bounds));
  assert.equal(ws.focused, second);
  assert.equal(state.scratchpadShown, second);
});

test("validate keeps the shown scratchpad window only while it is still floating somewhere", () => {
  const state = defaultState({ mobile: false });
  const ws = state.workspaces.home;
  const bounds = { x: 0, y: 0, w: 1200, h: 800 };
  const [first] = leafIds(ws.root);
  moveToScratchpad(state, ws, first);
  showScratchpad(state, ws, bounds);
  const kept = validate(structuredClone(state), defaultWindowIds(), defaultState({ mobile: false }));
  assert.equal(kept.scratchpadShown, first, "a shown window stays in the scratchpad across a reload");
  assert.ok(kept.workspaces.home.floating.some((node) => node.id === first));

  const escaped = structuredClone(state);
  escaped.workspaces.home.floating = [];
  const reset = validate(escaped, defaultWindowIds(), defaultState({ mobile: false }));
  assert.equal(reset.scratchpadShown, null);
});

test("validate sanitises layouts, percents, focus indices and float rects", () => {
  const state = defaultState({ mobile: false });
  const ws = state.workspaces.home;
  ws.root.layout = "grid";
  ws.root.percent = Number.NaN;
  ws.root.focus = -3;
  ws.root.children[0].percent = "wide";
  const [first] = leafIds(ws.root);
  toggleFloating(ws, first, { x: 10, y: 10, w: 300, h: 200 });
  ws.floating[0].floatRect = { x: Number.NaN, y: 5, w: "big" };
  const result = validate(state, defaultWindowIds(), defaultState({ mobile: false }));
  assert.equal(result.workspaces.home.root.layout, "splith");
  assert.equal(result.workspaces.home.root.percent, 1);
  assert.equal(result.workspaces.home.root.focus, 0);
  for (const child of result.workspaces.home.root.children) assert.ok(Number.isFinite(child.percent) && child.percent > 0);
  assert.equal(result.workspaces.home.floating[0].floatRect, null, "a malformed rect is dropped, never NaN");
  assert.equal(setLayout(ws, leafIds(ws.root)[0], "bogus"), false, "unknown layout names are refused");
});
