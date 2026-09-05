/* Window manager entry point and facade.

   Dependency direction is strictly one way: site.js imports this, and this never
   imports site.js. Routing and the launcher stay where they were; the window
   manager receives onWorkspaceRequest and isBlocked as injected callbacks.

   If anything in here throws, createWm returns null, html.wm-active is never
   added, and every fallback rule in the stylesheet renders the site exactly as
   the static version always did. */

import * as tree from "./tree.js?v=20260905h";
import { clampFloating, focusTarget, GEOMETRY } from "./layout.js?v=20260905h";
import { createRenderer } from "./render.js?v=20260905h";
import { installPointer } from "./pointer.js?v=20260905h";
import { installKeys } from "./keys.js?v=20260905h";
import { installBar } from "./bar.js?v=20260905h";
import { installNotify } from "./notify.js?v=20260905h";
import { announce, describeWindow, focusIsInside, installAnnouncer, refocus } from "./a11y.js?v=20260905h";
import { element, readGaps } from "./dom.js?v=20260905h";
import {
  clearGreetFlag,
  endSession,
  isSelfTest,
  media,
  prefs,
  shouldGreet,
  startSession,
  supported,
} from "./session.js?v=20260905h";
import { clear as clearStore, createSaver, load as loadStore } from "./store.js?v=20260905h";
import {
  defaultState,
  reapplyResponsiveDefaults,
  WALLPAPERS,
  WORKSPACES,
} from "./defaults.js?v=20260905h";
import { APP_NAMES, APPS, buildAppWindow } from "./apps/index.js?v=20260905h";
import { commandList, runCommand } from "./commands.js?v=20260905h";
import { installChrome } from "./chrome.js?v=20260905h";

const TITLE_BUTTONS = [
  ["minimize", "─", "Send to scratchpad"],
  ["maximize", "□", "Toggle fullscreen"],
  ["close", "×", "Close window"],
];

const upgradeTitlebar = (article) => {
  const marks = article.querySelector(".window-marks");
  if (!marks || marks.dataset.wmUpgraded) return;
  const group = element("span", "window-marks");
  group.dataset.wmUpgraded = "1";
  TITLE_BUTTONS.forEach(([action, glyph, label]) => {
    const button = element("button", `window-mark window-mark-${action}`, glyph);
    button.type = "button";
    button.dataset.wmAction = action;
    button.setAttribute("aria-label", label);
    group.append(button);
  });
  marks.replaceWith(group);
};

export const createWm = ({ onWorkspaceRequest, isBlocked, openLauncher }) => {
  if (!supported()) return null;

  const root = document.documentElement;
  const shell = document.querySelector(".desktop-shell");
  const layers = new Map();
  const decos = new Map();
  const empties = new Map();
  const windows = new Map();
  const apps = new Map();

  document.querySelectorAll("[data-wm-layer]").forEach((layer) => {
    layers.set(layer.dataset.wmLayer, layer);
    const deco = layer.querySelector("[data-wm-deco]");
    if (deco) decos.set(layer.dataset.wmLayer, deco);
    const empty = layer.querySelector("[data-wm-empty]");
    if (empty) empties.set(layer.dataset.wmLayer, empty);
  });
  document.querySelectorAll("[data-wm-window]").forEach((node) => {
    windows.set(node.dataset.wmWindow, node);
    upgradeTitlebar(node);
  });

  if (!shell || layers.size !== WORKSPACES.length || !windows.size) return null;

  /* The content renderer resolves these globally, after an awaited fetch. If the
     restructure ever duplicated one, entries would silently render into the wrong
     window, so assert it up front rather than debugging it later. */
  ["[data-content-list]", "[data-content-detail]"].forEach((selector) => {
    const collections = new Map();
    document.querySelectorAll(selector).forEach((node) => {
      const key = node.getAttribute(selector.slice(1, -1));
      collections.set(key, (collections.get(key) ?? 0) + 1);
    });
    for (const [key, count] of collections) {
      if (count > 1) console.error(`[wm] ${selector}="${key}" matches ${count} elements; expected 1`);
    }
  });

  installAnnouncer(document.querySelector("#workspace-announcer"));

  const liveIds = [...windows.keys()];
  const fallback = () => defaultState({ mobile: media.mobile.matches });
  let state = tree.validate(loadStore(), liveIds, fallback());
  /* A name stored before the wallpaper list changed would otherwise survive and
     leave data-wallpaper pointing at a rule that no longer exists. */
  if (!WALLPAPERS.includes(state.wallpaper)) state.wallpaper = WALLPAPERS[0];
  let active = "home";
  /* workspace back_and_forth: the workspace before this one. */
  let previous = null;
  let spawnCounter = 0;
  let destroyed = false;

  const save = createSaver(() => state);
  const activeWs = () => state.workspaces[active];

  /* Pointer and key handling stand down while a curtain is up — the greeter, a
     dialog, the launcher or the lock screen — so a drag can never start
     underneath one. */
  const blocked = () => isBlocked();

  const renderer = createRenderer({
    windows,
    layers,
    decos,
    empties,
    getState: () => state,
    getActive: () => active,
    /* Runtime `gaps` overrides win over the stylesheet's tokens. */
    gaps: () => {
      const css = readGaps();
      return { gapInner: state.gaps?.inner ?? css.inner, gapOuter: state.gaps?.outer ?? css.outer };
    },
  });

  const bar = installBar({
    container: document.querySelector("#i3status"),
    modeNode: document.querySelector("#wm-mode"),
    clockNode: document.querySelector("#local-clock"),
    workspaceLinks: [...document.querySelectorAll(".workspace-strip [data-workspace-link]")],
  });

  const dunst = installNotify({ container: document.querySelector("#dunst") });

  /* `touched` lists the workspaces whose structure the visitor just edited:
     those stop receiving responsive defaults on resize. Focus changes and tab
     taps persist without touching anything, or the first tap on a phone would
     freeze that workspace's layout forever. */
  const paint = ({ persist = true, touched = persist ? [active] : [], announceText, toast } = {}) => {
    renderer.schedule();
    updateCounts();
    for (const name of touched) state.workspaces[name].userTouched = true;
    if (persist) save();
    if (announceText) announce(announceText);
    if (toast) dunst.notify(toast.text, { key: toast.key ?? toast.text, timeout: toast.timeout, urgency: toast.timeout ? "normal" : "low" });
  };

  const updateCounts = () => {
    for (const name of WORKSPACES) {
      bar.setWindowCount(name, tree.allIds(state.workspaces[name]).length);
    }
  };

  const focusedTitle = () => describeWindow(windows.get(activeWs().focused));

  /* Focus must never be left on a hidden node: a screen reader would reset its
     virtual cursor to the top of the document and lose the reader's place. */
  const restoreFocus = (previous) => {
    const ws = activeWs();
    const target = ws.focused ? windows.get(ws.focused) : null;
    if (target && !target.hidden) {
      target.focus({ preventScroll: true });
      return;
    }
    refocus({
      candidates: tree.allIds(ws).map((id) => windows.get(id)),
      section: document.querySelector(`#${active}`),
      main: document.querySelector("#main-content"),
    });
    void previous;
  };

  const bounds = () => renderer.measure(active) ?? { x: 0, y: 0, w: 0, h: 0 };

  const wm = {

    setActiveWorkspace(name) {
      if (!state.workspaces[name]) return;
      if (name !== active) previous = active;
      active = name;
      bar.setUrgent(name, false);
      renderer.renderNow();
      updateCounts();
    },

    focusedWindowId: (name = active) => state.workspaces[name]?.focused ?? null,

    activeIsEmpty: () => tree.allIds(activeWs()).length === 0,

    windowCount: () => tree.allIds(activeWs()).length,
    workspaceCount: () => WORKSPACES.length,
    processList: () =>
      WORKSPACES.flatMap((name) =>
        tree.allIds(state.workspaces[name]).map((id) => ({
          title: windows.get(id)?.dataset.wmTitle ?? id,
          hidden: name !== active,
          focused: name === active && state.workspaces[name].focused === id,
        })),
      ),

    focusWindow(id, { moveBrowserFocus = true } = {}) {
      const ws = activeWs();
      if (!tree.allIds(ws).includes(id)) return false;
      const before = `${ws.focused}/${ws.focusMode}`;
      tree.setFocus(ws, id);
      if (ws.focusMode === "floating") tree.raiseFloating(ws, id);
      /* Tabbing through a link list fires focusin for every link; only a real
         focus change is worth a frame and a serialised write. */
      if (before !== `${ws.focused}/${ws.focusMode}` || ws.focusMode === "floating") {
        renderer.schedule();
        save();
      }
      if (moveBrowserFocus) windows.get(id)?.focus({ preventScroll: true });
      return true;
    },

    isVisible: (id) => {
      const node = windows.get(id);
      return Boolean(node) && !node.hidden && tree.allIds(activeWs()).includes(id);
    },

    focusTab(conId, index, id, { moveBrowserFocus = true } = {}) {
      const ws = activeWs();
      const con = tree.findCon(ws.root, conId);
      if (con) con.focus = index;
      if (id) tree.setFocus(ws, id);
      paint({ touched: [], announceText: `${describeWindow(windows.get(id))} focused` });
      /* Arrow keys keep focus on the roving tab; a click or Enter moves it into
         the window, as activating a tab does in i3. */
      if (moveBrowserFocus) windows.get(id)?.focus({ preventScroll: true });
    },

    focus(direction) {
      const ws = activeWs();
      const layout = renderer.getLayout(active);
      if (!layout || !ws.focused) return false;
      const best = focusTarget(layout, ws.focused, direction);
      if (!best) {
        /* Nothing visible that way: step through the focused tab container instead. */
        if (!tree.stepTabular(ws, direction)) return false;
        paint({ persist: false, announceText: `${focusedTitle()} focused` });
        windows.get(ws.focused)?.focus({ preventScroll: true });
        return true;
      }
      tree.setFocus(ws, best);
      if (tree.floatingNode(ws, best)) tree.raiseFloating(ws, best);
      paint({ persist: false });
      windows.get(best)?.focus({ preventScroll: true });
      return true;
    },

    move(direction) {
      const ws = activeWs();
      if (!ws.focused) return false;
      if (ws.floating.some((node) => node.id === ws.focused)) {
        const node = tree.floatingNode(ws, ws.focused);
        const step = 24;
        node.floatRect = clampFloating({
          ...node.floatRect,
          x: node.floatRect.x + (direction === "left" ? -step : direction === "right" ? step : 0),
          y: node.floatRect.y + (direction === "up" ? -step : direction === "down" ? step : 0),
        }, bounds());
        paint();
        return true;
      }
      if (!tree.moveLeaf(ws, ws.focused, direction)) return false;
      paint({ announceText: `${focusedTitle()} moved ${direction}`, toast: { text: `move ${direction}`, key: "move" } });
      return true;
    },

    split(orientation) {
      const ws = activeWs();
      if (!ws.focused || !tree.split(ws, ws.focused, orientation)) return false;
      paint({
        announceText: `split ${orientation === "h" ? "horizontal" : "vertical"}`,
        toast: { text: `split ${orientation}`, key: "layout" },
      });
      return true;
    },

    setLayout(layout) {
      const ws = activeWs();
      if (!ws.focused || !tree.setLayout(ws, ws.focused, layout)) return false;
      paint({ announceText: `${layout} layout`, toast: { text: `layout ${layout}`, key: "layout" } });
      return true;
    },

    toggleSplit() {
      const ws = activeWs();
      if (!ws.focused || !tree.toggleSplit(ws, ws.focused)) return false;
      paint({ announceText: "split orientation toggled", toast: { text: "toggle split", key: "layout" } });
      return true;
    },

    toggleFullscreen() {
      const ws = activeWs();
      if (!ws.focused) return false;
      tree.toggleFullscreen(ws, ws.focused);
      const on = ws.fullscreen === ws.focused;
      paint({
        announceText: on ? `${focusedTitle()} fullscreen` : `${focusedTitle()} restored`,
        toast: { text: on ? "fullscreen" : "fullscreen off", key: "fullscreen" },
      });
      return true;
    },

    exitFullscreen() {
      const ws = activeWs();
      if (!ws.fullscreen) return false;
      ws.fullscreen = null;
      paint({ announceText: "fullscreen off" });
      return true;
    },

    toggleFloating() {
      const ws = activeWs();
      if (!ws.focused) return false;
      const wasFloating = ws.floating.some((node) => node.id === ws.focused);
      if (!tree.toggleFloating(ws, ws.focused, bounds())) return false;
      paint({
        announceText: wasFloating ? `${focusedTitle()} tiled` : `${focusedTitle()} floating`,
        toast: { text: wasFloating ? "tiling" : "floating", key: "floating" },
      });
      return true;
    },

    toggleFocusMode() {
      const ws = activeWs();
      if (!ws.floating.length) return false;
      ws.focusMode = ws.focusMode === "floating" ? "tiling" : "floating";
      const pool = ws.focusMode === "floating"
        ? ws.floating.map((node) => node.id)
        : tree.leafIds(ws.root);
      if (pool.length) tree.setFocus(ws, pool[pool.length - 1]);
      paint({ announceText: `${ws.focusMode} focus`, toast: { text: `focus ${ws.focusMode}`, key: "focusmode" } });
      return true;
    },

    kill() {
      const ws = activeWs();
      const id = ws.focused;
      if (!id) return false;
      const node = windows.get(id);
      const movingFocus = focusIsInside(node);
      const title = describeWindow(node);
      /* Only window-manager-spawned windows are really destroyed. An authored
         window is hidden and remembered, so it can always be restored. */
      if (node?.classList.contains("wm-spawned")) {
        apps.get(id)?.destroy?.();
        apps.delete(id);
        tree.detachLeaf(ws, id);
        windows.delete(id);
        node.remove();
      } else {
        tree.killLeaf(ws, id);
      }
      const remaining = tree.allIds(ws).length;
      paint({
        announceText: `${title} closed. ${remaining} ${remaining === 1 ? "window remains" : "windows remain"}.`,
        toast: { text: `kill ${title}`, key: "kill" },
      });
      renderer.renderNow();
      if (movingFocus) restoreFocus(node);
      return true;
    },

    restoreAll() {
      const touched = WORKSPACES.filter((name) => tree.restoreKilled(state.workspaces[name]));
      if (touched.length) paint({ touched, announceText: "windows restored", toast: { text: "restore", key: "restore" } });
      return touched.length > 0;
    },

    restart() {
      /* Spawned windows go away; authored ones only ever lose their app instance,
         which is re-attached below. Restart must never delete site content. */
      for (const [id, app] of apps) {
        app.destroy?.();
        const node = windows.get(id);
        if (!node?.classList.contains("wm-spawned")) continue;
        node.remove();
        windows.delete(id);
      }
      apps.clear();
      state = fallback();
      clearStore();
      wm.applyGaps();
      wm.applyBar();
      updateCounts();
      attachHomeShell();
      announce("window manager restarted; every window restored");
      dunst.notify("restart i3 inplace", { key: "restart" });
      restoreFocus(null);
      return true;
    },

    resize(direction, ppt) {
      const ws = activeWs();
      if (!ws.focused) return false;
      const floating = tree.floatingNode(ws, ws.focused);
      if (floating) {
        const step = Math.round((ppt / 100) * 400);
        floating.floatRect = clampFloating({
          ...floating.floatRect,
          w: floating.floatRect.w + (direction === "right" ? step : direction === "left" ? -step : 0),
          h: floating.floatRect.h + (direction === "down" ? step : direction === "up" ? -step : 0),
        }, bounds());
        paint();
        return true;
      }
      if (!tree.resizeLeaf(ws, ws.focused, direction, ppt)) return false;
      paint();
      return true;
    },

    scratchpadShow() {
      if (!tree.showScratchpad(state, activeWs(), bounds())) {
        dunst.notify("scratchpad is empty", { key: "scratchpad" });
        return false;
      }
      paint({ announceText: "scratchpad toggled", toast: { text: "scratchpad", key: "scratchpad" } });
      return true;
    },

    scratchpadMove() {
      const ws = activeWs();
      if (!ws.focused || !tree.moveToScratchpad(state, ws, ws.focused)) return false;
      paint({ announceText: "window moved to scratchpad", toast: { text: "to scratchpad", key: "scratchpad" } });
      renderer.renderNow();
      restoreFocus(null);
      return true;
    },

    moveToWorkspaceIndex(index, { follow = false } = {}) {
      const target = WORKSPACES[index - 1];
      const ws = activeWs();
      if (!target || !ws.focused || target === active) return false;
      const title = focusedTitle();
      const id = ws.focused;
      if (!tree.moveToWorkspace(state, id, active, target)) return false;
      paint({
        touched: [active, target],
        announceText: `${title} moved to ${target}`,
        toast: { text: `move to ${index}:${target}`, key: "moveto" },
      });
      if (follow) {
        /* $mod+Shift+N in the original config: move the container and go with it. */
        tree.setFocus(state.workspaces[target], id);
        onWorkspaceRequest(index);
        return true;
      }
      bar.setUrgent(target, true);
      renderer.renderNow();
      restoreFocus(null);
      return true;
    },

    /* workspace_auto_back_and_forth: the active workspace's own number goes
       back to the previous one, as the original config had it. */
    requestWorkspace(index) {
      if (WORKSPACES[index - 1] === active) return wm.workspaceBackAndForth();
      onWorkspaceRequest(index);
      return true;
    },

    workspaceBackAndForth() {
      if (!previous || previous === active) return false;
      onWorkspaceRequest(WORKSPACES.indexOf(previous) + 1);
      return true;
    },

    moveToWorkspaceBackAndForth() {
      if (!previous || previous === active) return false;
      return wm.moveToWorkspaceIndex(WORKSPACES.indexOf(previous) + 1, { follow: true });
    },

    /* workspace next / prev: i3 does not wrap around. */
    stepWorkspace(step) {
      const index = WORKSPACES.indexOf(active) + step;
      if (index < 0 || index >= WORKSPACES.length) return false;
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
      const current = state.gaps[which] ?? css[which];
      const next = verb === "set" ? value : current + (verb === "plus" ? value : -value);
      state.gaps[which] = Math.max(which === "inner" ? 0 : -20, Math.min(next, 80));
      wm.applyGaps();
      paint({ announceText: `${which} gaps ${state.gaps[which]}`, toast: { text: `gaps ${which} ${state.gaps[which]}`, key: "gaps" } });
      return true;
    },

    applyGaps() {
      for (const which of ["inner", "outer"]) {
        if (state.gaps[which] === null) root.style.removeProperty(`--gaps-${which}`);
        else root.style.setProperty(`--gaps-${which}`, `${state.gaps[which]}px`);
      }
      renderer.invalidate();
      renderer.renderNow();
    },

    /* bar mode toggle | hide | dock. The bar stays in the DOM and the Tab
       order; hidden means slid away until hovered, focused, or a mode is up. */
    setBarMode(mode) {
      const next = mode === "toggle" ? (state.bar === "hide" ? "dock" : "hide") : mode;
      if (!["hide", "dock"].includes(next)) return false;
      state.bar = next;
      wm.applyBar();
      save();
      paint({ announceText: `bar ${next === "hide" ? "hidden" : "shown"}`, toast: { text: `bar mode ${next}`, key: "bar" } });
      return true;
    },

    applyBar() {
      root.dataset.bar = state.bar;
      renderer.invalidate();
      renderer.renderNow();
    },

    /* $mod+Shift+C: everything that is read from state rather than from the
       tree — gaps, the bar, labels — is re-applied, as a config reload would. */
    reload() {
      wm.applyGaps();
      wm.applyBar();
      bar.setLabels?.(state.barLabels);
      renderer.invalidate();
      renderer.renderNow();
      announce("configuration reloaded");
      dunst.notify("i3: reloaded", { key: "reload" });
      return true;
    },

    focusParent: () => false,
    setSticky: () => false,
    closeNotifications: () => (dunst.closeAll(), true),

    /* Dragging a tiled window by its title bar floats it, so touch and mouse
       behave the same without a separate code path. The rect comes from the
       drag proxy, so a fullscreen window lands at a manageable size. */
    placeFloating(id, rect) {
      const ws = activeWs();
      if (ws.fullscreen === id) ws.fullscreen = null;
      if (!tree.floatingNode(ws, id)) {
        tree.setFocus(ws, id);
        if (!tree.toggleFloating(ws, id, bounds())) return false;
      }
      const node = tree.floatingNode(ws, id);
      if (!node) return false;
      node.floatRect = clampFloating(rect, bounds());
      tree.raiseFloating(ws, id);
      paint();
      return true;
    },

    resizeFloating(id, rect) {
      const ws = activeWs();
      const node = tree.floatingNode(ws, id);
      if (!node) return false;
      node.floatRect = clampFloating(rect, bounds());
      paint();
      return true;
    },

    dragGutter(gutter, delta) {
      const ws = activeWs();
      const con = tree.findCon(ws.root, gutter.conId);
      if (!con) return false;
      const rect = con.rect;
      const span = gutter.orientation === "h" ? rect.w : rect.h;
      if (!span) return false;
      const ratio = delta / span;
      const first = con.children[gutter.index];
      const second = con.children[gutter.index + 1];
      if (!first || !second) return false;
      const min = GEOMETRY.minPx / span;
      const applied = Math.max(-(first.percent - min), Math.min(ratio, second.percent - min));
      first.percent += applied;
      second.percent -= applied;
      paint();
      return true;
    },

    floatAndDrag(id) {
      const ws = activeWs();
      if (tree.floatingNode(ws, id)) return false;
      tree.setFocus(ws, id);
      if (!tree.toggleFloating(ws, id, bounds())) return false;
      paint({ announceText: `${describeWindow(windows.get(id))} floating`, toast: { text: "floating", key: "floating" } });
      renderer.renderNow();
      pointer.rebaseDrag(id);
      return true;
    },

    canSwipe: (dx) => {
      const index = WORKSPACES.indexOf(active);
      return dx < 0 ? index < WORKSPACES.length - 1 : index > 0;
    },

    swipeWorkspace(step) {
      const index = WORKSPACES.indexOf(active) + step;
      if (index < 0 || index >= WORKSPACES.length) return false;
      onWorkspaceRequest(index + 1);
      dunst.notify(`workspace ${index + 1}:${WORKSPACES[index]}`, { key: "workspace" });
      return true;
    },

    openWorkspace(name) {
      const index = WORKSPACES.indexOf(name);
      if (index >= 0) onWorkspaceRequest(index + 1);
    },

    openRoute(route) {
      location.hash = `#${route}`;
    },

    openLauncher: () => openLauncher(":"),

    /* i3 answers $mod+Shift+E with a nagbar rather than exiting outright, so
       the session actions live behind one too. */
    togglePowerMenu(force) {
      const menu = document.querySelector("#power-menu");
      const toggle = document.querySelector("#power-menu-toggle");
      if (!menu) return false;
      const open = force ?? menu.hidden;
      menu.hidden = !open;
      toggle?.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector("[data-power]")?.focus({ preventScroll: true });
      else toggle?.focus({ preventScroll: true });
      return open;
    },

    powerMenuIsOpen: () => document.querySelector("#power-menu")?.hidden === false,

    mediaQueries: () => [media.mobile],

    /* i3exit: every session action, from the system mode, the nagbar, the
       launcher and the shell alike. The power sequences arrive with power.js;
       until then the actions that exist today are honoured and the rest are
       announced honestly. */
    power(action) {
      if (action === "lock") return Boolean(lock?.lock());
      if (action === "logout" || action === "exit") return wm.logout();
      if (action === "restart") return wm.restart();
      if (action === "switch_user") return (showGreeter("login"), true);
      if (["reboot", "shutdown", "suspend", "hibernate"].includes(action)) return wm.runPower(action);
      return false;
    },

    /* The power sequences live in power.js and borrow the greeter's screen.
       A reboot or shutdown ends the stored session at the *start*, so a reload
       mid-sequence lands on the boot screen — the right outcome for a machine
       that was going down — and closes every spawned window, as a real reboot
       would; the saved layout survives, like persisted i3 layout files. */
    runPower(action) {
      powerInstance?.destroy();
      greeterInstance?.destroy();
      greeterInstance = null;
      import("./power.js?v=20260905h").then(({ runPower }) => {
        powerInstance = runPower({
          node: document.querySelector("#greeter"),
          action,
          reducedMotion: media.reducedMotion.matches,
          hooks: {
            beforeShutdown: () => {
              save.flush();
              for (const [id, app] of apps) {
                const node = windows.get(id);
                if (!node?.classList.contains("wm-spawned")) continue;
                app.destroy?.();
                apps.delete(id);
                for (const name of WORKSPACES) tree.detachLeaf(state.workspaces[name], id);
                windows.delete(id);
                node.remove();
              }
              state.scratchpad = state.scratchpad.filter((leaf) => windows.has(leaf.id));
              endSession();
              dunst.closeAll();
              renderer.renderNow();
            },
            showGreeter: (mode) => {
              powerInstance = null;
              showGreeter(mode);
            },
            lock: () => {
              powerInstance = null;
              lock?.lock();
              announce("screen locked");
            },
          },
        });
      }).catch(() => {
        powerInstance = null;
        dunst.notify(`${action}: power management unavailable`, { key: "power" });
      });
      dunst.notify(`i3exit ${action}`, { key: "power" });
      return true;
    },

    /* Ends the stored session and returns to the greeter's login panel — no
       boot log, exactly as logging out of a running X session behaves. */
    logout() {
      endSession();
      dunst.notify("logging out", { key: "session" });
      announce("logged out; showing the login screen");
      showGreeter("login");
      return true;
    },

    wallpaper: () => state.wallpaper,

    setWallpaper(name) {
      if (!WALLPAPERS.includes(name)) return false;
      state.wallpaper = name;
      root.dataset.wallpaper = name;
      save();
      announce(`wallpaper ${name}`);
      return true;
    },

    /* Resolves once the application is running. The window itself appears
       synchronously so `exec` feels immediate; its module may still be loading. */
    async spawn(appName) {
      const spec = APPS[appName];
      if (!spec) return false;
      spawnCounter += 1;
      const id = `${appName}-${spawnCounter}`;
      const { article, title, body, status } = buildAppWindow(id, spec);
      upgradeTitlebar(article);

      layers.get(active)?.insertBefore(article, decos.get(active) ?? null);
      windows.set(id, article);

      const ws = activeWs();
      const leaf = tree.makeLeaf(id);
      leaf.spawned = true;
      tree.insertChild(ws.root, leaf, ws.root.children.length);
      tree.normalize(ws.root);
      tree.setFocus(ws, id);
      renderer.renderNow();

      let instance;
      try {
        instance = await spec.create({ body, statusline: status, title, wm, close: () => wm.killWindow(id) });
        if (!windows.has(id)) {
          /* Killed while its module was still loading. */
          instance?.destroy?.();
          return false;
        }
      } catch (error) {
        if (!windows.has(id)) return false;
        /* An application that throws must not leave a window with no app behind
           it: the leaf and the node go, and the desktop is exactly as before. */
        console.error(`[wm] exec ${appName} failed`, error);
        tree.detachLeaf(ws, id);
        windows.delete(id);
        article.remove();
        renderer.renderNow();
        restoreFocus(null);
        dunst.notify(`exec ${appName} failed`, { key: "exec" });
        return false;
      }
      apps.set(id, instance ?? {});
      paint({ announceText: `${spec.title} opened`, toast: { text: `exec ${appName}`, key: "exec" } });
      renderer.renderNow();
      instance?.focus?.();
      return true;
    },

    /* Close a specific window wherever it lives now — an application's own
       close button must not act on whichever window happens to be focused. */
    killWindow(id) {
      const wsName = WORKSPACES.find((name) => tree.allIds(state.workspaces[name]).includes(id));
      if (!wsName) return false;
      if (wsName !== active) onWorkspaceRequest(WORKSPACES.indexOf(wsName) + 1);
      tree.setFocus(state.workspaces[wsName], id);
      return wm.kill();
    },

    runCommand: (text) => runCommand(wm, commandContext, text),

    onModeChange: (mode, prompt) => {
      bar.setMode(mode, prompt);
      if (mode !== "default") dunst.notify(`mode ${mode}`, { key: "mode" });
    },

    commands: () => commandList(wm, commandContext),

    bindings: () => keys.bindings(),
    resizeBindings: () => keys.resizeBindings(),

    destroy() {
      if (destroyed) return;
      destroyed = true;
      keys.destroy();
      pointer.destroy();
      bar.destroy();
      dunst.destroy();
      lock?.destroy();
      touch?.destroy();
      greeterInstance?.destroy();
      powerInstance?.destroy();
      for (const [, app] of apps) app.destroy?.();
      apps.clear();
      removeChrome();
      save.destroy();
      renderer.destroy();
      root.classList.remove("wm-active");
    },
  };

  const keys = installKeys({ wm, isBlocked: blocked, onWorkspaceRequest, openLauncher });

  /* What the command language needs beyond the facade. Functions rather than
     values where the thing is created later in this file. */
  const commandContext = {
    workspaces: WORKSPACES,
    apps: APP_NAMES,
    appLabel: (name) => APPS[name].label,
    wallpapers: WALLPAPERS,
    onWorkspaceRequest,
    keys: () => keys,
    lock: () => lock,
    showGreeter: (mode) => showGreeter(mode),
    openCms: () => document.querySelector("#j3w1ctl-launch")?.click(),
    openWiki: () => window.open("/wiki/", "_blank", "noopener"),
    prefs,
    dunst,
    announce,
  };
  const pointer = installPointer({
    wm,
    layers,
    decos,
    getLayout: (name) => renderer.getLayout(name),
    getActive: () => active,
    isEnabled: () => !blocked(),
  });

  let lock = null;
  let touch = null;
  let greeterInstance = null;
  let powerInstance = null;

  let greeterLoading = null;
  const showGreeter = (mode) => {
    /* One instance at a time: a second `exec lightdm` while the first is up, or
       while the module is still loading, must not stack a second boot log and a
       second set of key listeners over the first. */
    greeterInstance?.destroy();
    greeterInstance = null;
    if (greeterLoading) return greeterLoading;
    greeterLoading = import("./greeter.js?v=20260905h").then(({ runGreeter }) => {
      greeterLoading = null;
      greeterInstance = runGreeter({
        node: document.querySelector("#greeter"),
        mode,
        reducedMotion: media.reducedMotion.matches,
        onLogin: () => {
          greeterInstance = null;
          startSession();
          clearGreetFlag();
          renderer.invalidate();
          renderer.renderNow();
          announce("logged in to the i3 session");
          restoreFocus(null);
        },
      });
    }).catch(() => {
      /* If the greeter cannot load, do not strand the visitor behind it. */
      greeterLoading = null;
      startSession();
      clearGreetFlag();
    });
    return greeterLoading;
  };

  /* The chrome handlers live in chrome.js; this is the teardown they return. */
  const removeChrome = installChrome({
    wm,
    windows,
    renderer,
    restoreFocus,
    isBlocked: blocked,
    root,
    power: (action) => wm.power(action),
    onResize: () => {
      if (reapplyResponsiveDefaults(state, { mobile: media.mobile.matches })) save();
      renderer.invalidate();
      renderer.renderNow();
    },
  });

  root.dataset.wallpaper = state.wallpaper;
  for (const which of ["inner", "outer"]) {
    if (state.gaps[which] !== null) root.style.setProperty(`--gaps-${which}`, `${state.gaps[which]}px`);
  }
  root.dataset.bar = state.bar;
  root.dataset.wm = "on";
  root.classList.add("wm-active");
  renderer.renderNow();
  updateCounts();

  /* The home terminal is authored markup, so its transcript survives with no
     JavaScript. Here it gains a real prompt and becomes an interactive shell. */
  function attachHomeShell() {
    const terminal = windows.get("home-terminal");
    if (!terminal || apps.has("home-terminal")) return;
    apps.set("home-terminal", APPS.urxvt.create({
      body: terminal,
      statusline: terminal.querySelector(".terminal-statusline"),
      title: terminal.querySelector(".window-titlebar > span"),
      wm,
      close: () => wm.killWindow("home-terminal"),
    }));
  }

  attachHomeShell();

  if (media.coarse.matches) {
    import("./touch.js?v=20260905h")
      .then(({ installTouch }) => {
        touch = installTouch({ shell, wm, isBlocked: blocked });
      })
      .catch(() => {});
  }

  import("./idle-lock.js?v=20260905h")
    .then(({ installIdleLock }) => {
      lock = installIdleLock({
        node: document.querySelector("#lockscreen"),
        isBusy: () => isBlocked() || Boolean(greeterInstance) || Boolean(powerInstance),
        onLock: () => dunst.notify("i3lock", { key: "lock" }),
      });
    })
    .catch(() => {});

  if (shouldGreet() && prefs.boot) showGreeter("boot");
  else startSession();

  if (isSelfTest()) {
    import("./selftest.js?v=20260905h")
      .then(({ runSelfTest }) => runSelfTest())
      .catch((error) => console.error("[wm] selftest failed to load", error));
  }

  return wm;
};
