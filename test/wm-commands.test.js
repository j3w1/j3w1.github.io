import assert from "node:assert/strict";
import test from "node:test";
import { commandList, parseCommand, runCommand } from "../assets/js/wm/commands.js";
import { focusTarget } from "../assets/js/wm/layout.js";
import { leafIds, setLayout, stepTabular } from "../assets/js/wm/tree.js";
import { defaultState } from "../assets/js/wm/defaults.js";

test("parseCommand tokenises i3-msg text with ; chaining", () => {
  assert.deepEqual(parseCommand("  Workspace 2 ;  layout   Tabbed; "), [
    { op: "workspace", args: ["2"] },
    { op: "layout", args: ["tabbed"] },
  ]);
  assert.deepEqual(parseCommand(""), []);
  assert.deepEqual(parseCommand("[con_mark=x] focus"), [{ op: "[con_mark=x]", args: ["focus"] }]);
});

const facade = (log) => new Proxy({}, {
  get: (target, name) => (...args) => {
    log.push([name, ...args]);
    return true;
  },
});

const context = () => ({
  workspaces: ["home", "writing", "projects"],
  apps: ["urxvt", "neofetch"],
  appLabel: (name) => name,
  wallpapers: ["black"],
  onWorkspaceRequest: () => {},
  keys: () => ({ setMode: () => true }),
  lock: () => null,
  showGreeter: () => {},
  openCms: () => {},
  openWiki: () => {},
  prefs: {},
  dunst: { notify: () => {} },
  announce: () => {},
});

test("runCommand dispatches every launcher label through the same parser", () => {
  const log = [];
  const wm = facade(log);
  const ctx = context();
  for (const entry of commandList(wm, ctx)) entry.run();
  assert.ok(log.some(([name]) => name === "setLayout"), "layout commands reach the facade");
  assert.ok(log.some(([name, value]) => name === "moveToWorkspaceIndex" && value === 3), "move to workspace parses the index");
  assert.ok(log.some(([name, value]) => name === "spawn" && value === "neofetch"), "exec parses the program");
  assert.equal(runCommand(wm, ctx, "layout garbage"), "unknown layout: garbage");
  assert.equal(runCommand(wm, ctx, "frobnicate"), "unknown command: frobnicate");
  assert.equal(runCommand(wm, ctx, ""), "empty command");
  assert.equal(runCommand(wm, ctx, "exec nope"), "unknown program: nope");
  assert.equal(runCommand(wm, ctx, "workspace 2; layout tabbed"), "");
  assert.equal(runCommand(wm, ctx, "resize grow width 10"), "");
  assert.deepEqual(log.at(-1), ["resize", "right", 10]);
});

test("focusTarget picks the nearest centre in a direction, ties broken on the perpendicular axis", () => {
  const tiles = new Map([
    ["a", { x: 0, y: 0, w: 100, h: 100 }],
    ["b", { x: 100, y: 0, w: 100, h: 100 }],
    ["c", { x: 0, y: 100, w: 100, h: 100 }],
    ["far", { x: 400, y: 10, w: 100, h: 100 }],
  ]);
  const result = { tiles, floats: new Map() };
  assert.equal(focusTarget(result, "a", "right"), "b");
  assert.equal(focusTarget(result, "a", "down"), "c", "the window directly below wins over a nearer one off to the side");
  assert.equal(focusTarget(result, "a", "left"), null);
  assert.equal(focusTarget(result, "b", "right"), "far");
  assert.equal(focusTarget(result, "missing", "right"), null);
});

test("stepTabular walks the focused tabbed container when nothing is visible that way", () => {
  const state = defaultState({ mobile: false });
  const ws = state.workspaces.home;
  const [first, second] = leafIds(ws.root);
  setLayout(ws, first, "tabbed");
  ws.focused = first;
  ws.root.focus = 0;
  assert.equal(stepTabular(ws, "right"), true);
  assert.equal(ws.focused, second);
  assert.equal(stepTabular(ws, "right"), false, "no further tab to the right");
  assert.equal(stepTabular(ws, "left"), true);
  assert.equal(ws.focused, first);
  setLayout(ws, first, "splith");
  assert.equal(stepTabular(ws, "right"), false, "no tabular ancestor: nothing to step");
});
