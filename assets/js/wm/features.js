/* The facade methods ported from the original config that the core desktop
   did not need: workspace back-and-forth and stepping, per-window borders,
   i3-gaps, the bar modes, reload, container focus, sticky, marks and swaps,
   and the floating setters. They read and write the same state as boot.js
   through `ctx`, and are spread into the facade there; keeping them here
   keeps boot.js the small core it is meant to be. */

import { clampFloating } from "./layout.js?v=20260905h";
import { readGaps } from "./dom.js?v=20260905h";
import * as tree from "./tree.js?v=20260905h";
import * as extra from "./tree-extras.js?v=20260905h";

export const installFeatures = (ctx) => {
  const { workspaces, onWorkspaceRequest, windows, paint, focusedTitle, dunst, announce, root, renderer, save, bar, bounds, stickyIds } = ctx;
  const wm = () => ctx.wm();
  const state = () => ctx.state();
  const active = () => ctx.active();
  const activeWs = () => state().workspaces[active()];

  return {
    /* workspace_auto_back_and_forth: the active workspace's own number goes
       back to the previous one, as the original config had it. */
    requestWorkspace(index) {
      if (workspaces[index - 1] === active()) return wm().workspaceBackAndForth();
      onWorkspaceRequest(index);
      return true;
    },

    workspaceBackAndForth() {
      const previous = ctx.previous();
      if (!previous || previous === active()) return false;
      onWorkspaceRequest(workspaces.indexOf(previous) + 1);
      return true;
    },

    moveToWorkspaceBackAndForth() {
      const previous = ctx.previous();
      if (!previous || previous === active()) return false;
      return wm().moveToWorkspaceIndex(workspaces.indexOf(previous) + 1, { follow: true });
    },

    /* workspace next / prev: i3 does not wrap around. */
    stepWorkspace(step) {
      const index = workspaces.indexOf(active()) + step;
      if (index < 0 || index >= workspaces.length) return false;
      onWorkspaceRequest(index + 1);
      return true;
    },

    /* border none | pixel [N] | normal | toggle, on the focused window. */
    setBorder(style, width) {
      const ws = activeWs();
      const leaf = ws.focused ? tree.leafFor(ws, ws.focused) : null;
      if (!leaf) return false;
      const order = ["normal", "pixel", "none"];
      const next = style === "toggle" ? order[(order.indexOf(leaf.border ?? "normal") + 1) % order.length] : style;
      if (!tree.BORDERS.has(next)) return false;
      if (next === "normal") delete leaf.border;
      else leaf.border = next;
      const label = next === "pixel" ? `pixel ${width ?? 1}` : next;
      paint({ announceText: `border ${label}`, toast: { text: `Border set to ${label}`, key: "border", timeout: dunst.appTimeout } });
      return true;
    },

    /* gaps inner|outer current|all set|plus|minus N — global here: per-workspace
       gaps are an i3-gaps extension the tree does not model. */
    gaps(args) {
      const [which, , verb, amount] = args.length === 4 ? args : [args[0], "all", args[1], args[2]];
      if (!["inner", "outer"].includes(which) || !["set", "plus", "minus"].includes(verb)) return false;
      const value = Number.parseInt(amount, 10);
      if (!Number.isFinite(value)) return false;
      const css = readGaps();
      const current = state().gaps[which] ?? css[which];
      const next = verb === "set" ? value : current + (verb === "plus" ? value : -value);
      state().gaps[which] = Math.max(which === "inner" ? 0 : -20, Math.min(next, 80));
      wm().applyGaps();
      paint({ announceText: `${which} gaps ${state().gaps[which]}`, toast: { text: `gaps ${which} ${state().gaps[which]}`, key: "gaps" } });
      return true;
    },

    applyGaps() {
      for (const which of ["inner", "outer"]) {
        if (state().gaps[which] === null) root.style.removeProperty(`--gaps-${which}`);
        else root.style.setProperty(`--gaps-${which}`, `${state().gaps[which]}px`);
      }
      renderer.invalidate();
      renderer.renderNow();
    },

    /* bar mode toggle | hide | dock. The bar stays in the DOM and the Tab
       order; hidden means slid away until hovered, focused, or a mode is up. */
    setBarMode(mode) {
      const next = mode === "toggle" ? (state().bar === "hide" ? "dock" : "hide") : mode;
      if (!["hide", "dock"].includes(next)) return false;
      state().bar = next;
      wm().applyBar();
      save();
      paint({ announceText: `bar ${next === "hide" ? "hidden" : "shown"}`, toast: { text: `bar mode ${next}`, key: "bar" } });
      return true;
    },

    applyBar() {
      root.dataset.bar = state().bar;
      renderer.invalidate();
      renderer.renderNow();
    },

    /* $mod+Shift+C: everything that is read from state rather than from the
       tree — gaps, the bar, labels — is re-applied, as a config reload would. */
    reload() {
      wm().applyGaps();
      wm().applyBar();
      bar.setLabels?.(state().barLabels);
      renderer.invalidate();
      renderer.renderNow();
      announce("configuration reloaded");
      dunst.notify("i3: reloaded", { key: "reload" });
      return true;
    },

    /* focus parent / child: a focused container is outlined and receives the
       layout, split and kill commands until focus moves to a window again. */
    focusParent() {
      const ws = activeWs();
      const con = extra.focusParent(ws);
      if (!con) return false;
      const count = extra.conSize(con);
      paint({ persist: false, announceText: `container of ${count} ${count === 1 ? "window" : "windows"} focused`, toast: { text: "focus parent", key: "focus" } });
      return true;
    },

    focusChild() {
      const ws = activeWs();
      if (!extra.focusChild(ws)) return false;
      const con = extra.focusedCon(ws);
      paint({ persist: false, announceText: con ? `container of ${extra.conSize(con)} windows focused` : `${focusedTitle()} focused` });
      return true;
    },

    /* sticky toggle | enable | disable: a floating spawned window is shown on
       every workspace. Authored windows cannot leave their section, so they
       are refused honestly rather than half-done. */
    setSticky(action = "toggle") {
      const ws = activeWs();
      const id = ws.focused;
      const node = windows.get(id);
      if (!id || !node) return false;
      const wanted = action === "toggle" ? !stickyIds.has(id) : action === "enable";
      if (wanted && !node.classList.contains("wm-spawned")) {
        dunst.notify("sticky: site windows stay on their workspace", { key: "sticky", timeout: dunst.appTimeout });
        announce("sticky is for spawned windows; site windows stay on their workspace");
        return false;
      }
      if (wanted && !tree.floatingNode(ws, id)) tree.toggleFloating(ws, id, bounds());
      if (wanted) stickyIds.add(id);
      else stickyIds.delete(id);
      paint({ announceText: wanted ? `${focusedTitle()} sticky` : `${focusedTitle()} no longer sticky`, toast: { text: wanted ? "sticky on" : "sticky off", key: "sticky" } });
      return true;
    },

    isSticky: (id) => stickyIds.has(id),

    mark(name) {
      const ws = activeWs();
      if (!ws.focused || !name || !extra.setMark(state(), active(), ws.focused, name)) return false;
      paint({ announceText: `marked ${name}`, toast: { text: `mark ${name}`, key: "mark" } });
      return true;
    },

    unmark(name) {
      const ws = activeWs();
      if (!ws.focused || !extra.unmark(state(), active(), ws.focused, name)) return false;
      paint({ announceText: name ? `unmarked ${name}` : "marks removed", toast: { text: "unmark", key: "mark" } });
      return true;
    },

    /* [con_mark=NAME] focus: switch to the window's workspace if needed. */
    focusMark(name) {
      const found = extra.findMark(state(), name);
      if (!found) return false;
      if (found.wsName !== active()) onWorkspaceRequest(workspaces.indexOf(found.wsName) + 1);
      return wm().focusWindow(found.leaf.id);
    },

    swapWith(name) {
      const ws = activeWs();
      const found = extra.findMark(state(), name);
      if (!ws.focused || !found) return false;
      if (found.wsName !== active()) {
        dunst.notify("swap: both windows must share a workspace", { key: "swap" });
        return false;
      }
      if (!extra.swapLeaves(ws, ws.focused, found.leaf.id)) return false;
      paint({ announceText: `swapped with ${name}`, toast: { text: `swap ${name}`, key: "swap" } });
      return true;
    },

    resizeSet(w, h) {
      const ws = activeWs();
      if (!ws.focused || !extra.resizeFloatingTo(ws, ws.focused, w, h)) return false;
      const node = tree.floatingNode(ws, ws.focused);
      node.floatRect = clampFloating(node.floatRect, bounds());
      paint({ announceText: `resized to ${w} by ${h}` });
      return true;
    },

    centerFloating() {
      const ws = activeWs();
      if (!ws.focused || !extra.centreFloating(ws, ws.focused, bounds())) return false;
      paint({ announceText: "centred" });
      return true;
    },

    closeNotifications: () => (dunst.closeAll(), true),
  };
};
