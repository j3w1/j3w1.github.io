import assert from "node:assert/strict";
import test from "node:test";
import { defaultState } from "../assets/js/wm/defaults.js";
import { leafIds, makeCon, makeLeaf, normalize, split, toggleFloating, validate } from "../assets/js/wm/tree.js";
import { centreFloating, findMark, focusChild, focusParent, focusedCon, resizeFloatingTo, setMark, swapLeaves, unmark } from "../assets/js/wm/tree-extras.js";
import { serialize } from "../assets/js/wm/store.js";

const fresh = () => defaultState({ mobile: false });

test("focus parent climbs to the root and focus child descends the same path", () => {
  const state = fresh();
  const ws = state.workspaces.home;
  /* root splith [ a, splitv [ b, c ] ] — a real nesting, which split() on a
     two-window root would collapse straight back into the root. */
  const nested = makeCon("splitv", [makeLeaf("b", 0.5), makeLeaf("c", 0.5)]);
  ws.root = makeCon("splith", [makeLeaf("a", 0.5), nested]);
  normalize(ws.root);
  ws.focused = "b";
  const inner = focusParent(ws);
  assert.ok(inner && inner.id !== ws.root.id, "the first parent is the nested container");
  assert.equal(focusedCon(ws)?.id, inner.id);
  const root = focusParent(ws);
  assert.equal(root, ws.root);
  assert.equal(focusParent(ws), null, "nothing above the root");
  assert.equal(focusedCon(ws), ws.root);
  assert.equal(focusChild(ws), true);
  assert.equal(focusedCon(ws)?.id, inner.id);
  assert.equal(focusChild(ws), true);
  assert.equal(focusedCon(ws), null, "back on the leaf");
  void split;
});

test("marks are unique across the state, rendered from the leaf, and survive a round trip", () => {
  const state = fresh();
  const [a, b] = leafIds(state.workspaces.home.root);
  assert.equal(setMark(state, "home", a, "x"), true);
  assert.equal(setMark(state, "home", b, "x"), true, "the mark moves to the other window");
  assert.equal(findMark(state, "x").leaf.id, b);
  assert.equal(setMark(state, "home", a, "not valid!"), false);
  assert.equal(setMark(state, "writing", leafIds(state.workspaces.writing.root)[0], "far"), true);
  assert.equal(findMark(state, "far").wsName, "writing");
  const restored = validate(structuredClone(serialize(state)), leafIds(state.workspaces.home.root).concat(leafIds(state.workspaces.writing.root), ...Object.values(state.workspaces).map((ws) => leafIds(ws.root))), fresh());
  assert.equal(findMark(restored, "x")?.leaf.id, b);
  assert.equal(findMark(restored, "far")?.wsName, "writing");
  assert.equal(unmark(state, "home", b, "x"), true);
  assert.equal(findMark(state, "x"), null);
});

test("validate drops malformed and duplicate marks", () => {
  const state = fresh();
  const ws = state.workspaces.home;
  const [a, b] = leafIds(ws.root);
  ws.root.children[0].marks = ["ok", "BAD MARK", 42, "dup"];
  ws.root.children[1].marks = ["dup"];
  const live = Object.values(state.workspaces).flatMap((each) => leafIds(each.root));
  const result = validate(state, live, fresh());
  assert.deepEqual(result.workspaces.home.root.children[0].marks, ["ok", "dup"]);
  assert.equal(result.workspaces.home.root.children[1].marks, undefined);
  void a; void b;
});

test("swap trades two leaves' positions and shares; floating setters clamp sanely", () => {
  const state = fresh();
  const ws = state.workspaces.home;
  const [a, b] = leafIds(ws.root);
  const [pa, pb] = ws.root.children.map((child) => child.percent);
  assert.equal(swapLeaves(ws, a, b), true);
  assert.deepEqual(leafIds(ws.root), [b, a]);
  assert.deepEqual(ws.root.children.map((child) => child.percent), [pa, pb], "shares stay with the positions");
  assert.equal(swapLeaves(ws, a, a), false);

  const bounds = { x: 0, y: 0, w: 1000, h: 800 };
  toggleFloating(ws, a, bounds);
  assert.equal(resizeFloatingTo(ws, a, 400, 300), true);
  assert.equal(centreFloating(ws, a, bounds), true);
  const rect = ws.floating[0].floatRect;
  assert.deepEqual([rect.x, rect.y, rect.w, rect.h], [300, 250, 400, 300]);
  assert.equal(resizeFloatingTo(ws, a, 0, 10), false);
  assert.equal(resizeFloatingTo(ws, b, 10, 10), false, "not floating");
});
