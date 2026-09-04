/* Window manager entry point and facade.

   Dependency direction is strictly one way: site.js imports this, and this never
   imports site.js. Routing and the launcher stay where they were; the window
   manager receives onWorkspaceRequest and isBlocked as injected callbacks.

   If anything in here throws, createWm returns null, html.wm-active is never
   added, and every fallback rule in the stylesheet renders the site exactly as
   the static version always did. */

import * as tree from "./tree.js?v=20260904";
import { clampFloating, GEOMETRY } from "./layout.js?v=20260904";
import { createRenderer } from "./render.js?v=20260904";
import { installPointer } from "./pointer.js?v=20260904";
import { installKeys } from "./keys.js?v=20260904";
import { installBar } from "./bar.js?v=20260904";
import { installNotify } from "./notify.js?v=20260904";
import { announce, describeWindow, focusIsInside, installAnnouncer, refocus } from "./a11y.js?v=20260904";
import { element, readGap } from "./dom.js?v=20260904";
import {
  clearGreetFlag,
  endSession,
  isPlainRequested,
  isSelfTest,
  media,
  params,
  prefs,
  shouldGreet,
  startSession,
  supported,
} from "./session.js?v=20260904";
import { clear as clearStore, createSaver, load as loadStore } from "./store.js?v=20260904";
import {
  defaultState,
  defaultWindowIds,
  homeWorkspaceFor,
  reapplyResponsiveDefaults,
  WALLPAPERS,
  WORKSPACES,
} from "./defaults.js?v=20260904";
import { APP_NAMES, APPS } from "./apps/index.js?v=20260904";

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
  if (!supported() || isPlainRequested()) return null;

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
  let active = "home";
  let spawnCounter = 0;
  let destroyed = false;
  let enabled = true;

  const save = createSaver(() => state);
  const activeWs = () => state.workspaces[active];

  /* One switch every input path consults, so turning the window manager off
     really turns it off rather than leaving handlers running over a plain
     document. Declared here so the facade below can reference it. */
  const isEnabled = () => enabled;
  const blocked = () => !enabled || isBlocked();

  const renderer = createRenderer({
    windows,
    layers,
    decos,
    empties,
    getState: () => state,
    getActive: () => active,
    gap: readGap,
  });

  const bar = installBar({
    container: document.querySelector("#i3status"),
    modeNode: document.querySelector("#wm-mode"),
    clockNode: document.querySelector("#local-clock"),
    workspaceLinks: [...document.querySelectorAll(".workspace-strip [data-workspace-link]")],
  });

  const dunst = installNotify({ container: document.querySelector("#dunst") });

  const paint = ({ persist = true, announceText, toast } = {}) => {
    renderer.schedule();
    updateCounts();
    if (persist) {
      activeWs().userTouched = true;
      save();
    }
    if (announceText) announce(announceText);
    if (toast) dunst.notify(toast.text, { key: toast.key ?? toast.text });
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
    modPreference: () => state.modPreference,

    setActiveWorkspace(name) {
      if (!state.workspaces[name]) return;
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
      tree.setFocus(ws, id);
      if (ws.focusMode === "floating") tree.raiseFloating(ws, id);
      renderer.schedule();
      save();
      if (moveBrowserFocus) windows.get(id)?.focus({ preventScroll: true });
      return true;
    },

    focusTab(conId, index, id) {
      const ws = activeWs();
      const con = tree.findCon(ws.root, conId);
      if (con) con.focus = index;
      if (id) tree.setFocus(ws, id);
      paint({ announceText: `${describeWindow(windows.get(id))} focused` });
      windows.get(id)?.focus({ preventScroll: true });
    },

    focus(direction) {
      const ws = activeWs();
      const layout = renderer.getLayout(active);
      if (!layout || !ws.focused) return false;
      const current = layout.tiles.get(ws.focused) ?? layout.floats.get(ws.focused);
      if (!current) return false;
      const centre = { x: current.x + current.w / 2, y: current.y + current.h / 2 };
      const visible = [...layout.tiles, ...layout.floats].filter(([id]) => id !== ws.focused);

      /* Geometric descent, like i3: nearest centre in the requested direction,
         breaking ties on the perpendicular axis. */
      const best = visible
        .map(([id, rect]) => {
          const dx = rect.x + rect.w / 2 - centre.x;
          const dy = rect.y + rect.h / 2 - centre.y;
          const valid =
            (direction === "left" && dx < -2) ||
            (direction === "right" && dx > 2) ||
            (direction === "up" && dy < -2) ||
            (direction === "down" && dy > 2);
          if (!valid) return null;
          const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
          const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
          return { id, score: primary * 10 + secondary };
        })
        .filter(Boolean)
        .sort((a, b) => a.score - b.score)[0];

      if (!best) {
        /* Nothing visible that way: step through the focused tab container instead. */
        const path = tree.pathTo(ws.root, ws.focused);
        const container = path?.reverse().find(({ con }) => tree.isTabular(con.layout));
        if (!container) return false;
        const step = direction === "right" || direction === "down" ? 1 : -1;
        const next = container.con.focus + step;
        if (next < 0 || next >= container.con.children.length) return false;
        container.con.focus = next;
        const leaf = tree.representativeLeaf(container.con.children[next]);
        if (leaf) tree.setFocus(ws, leaf.id);
        paint({ persist: false, announceText: `${focusedTitle()} focused` });
        windows.get(ws.focused)?.focus({ preventScroll: true });
        return true;
      }

      tree.setFocus(ws, best.id);
      if (ws.floating.some((node) => node.id === best.id)) tree.raiseFloating(ws, best.id);
      paint({ persist: false });
      windows.get(best.id)?.focus({ preventScroll: true });
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
      let changed = false;
      for (const name of WORKSPACES) {
        if (tree.restoreKilled(state.workspaces[name])) changed = true;
      }
      if (changed) paint({ announceText: "windows restored", toast: { text: "restore", key: "restore" } });
      return changed;
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
      renderer.invalidate();
      renderer.renderNow();
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

    moveToWorkspaceIndex(index) {
      const target = WORKSPACES[index - 1];
      const ws = activeWs();
      if (!target || !ws.focused) return false;
      const title = focusedTitle();
      if (!tree.moveToWorkspace(state, ws.focused, active, target)) return false;
      paint({
        announceText: `${title} moved to ${target}`,
        toast: { text: `move to ${index}:${target}`, key: "moveto" },
      });
      bar.setUrgent(target, true);
      renderer.renderNow();
      restoreFocus(null);
      return true;
    },

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

    spawn(appName) {
      const spec = APPS[appName];
      if (!spec) return false;
      spawnCounter += 1;
      const id = `${appName}-${spawnCounter}`;
      const article = element("article", `window pane wm-spawned ${spec.className}`);
      article.dataset.wmWindow = id;
      article.dataset.wmTitle = spec.title;
      article.tabIndex = 0;
      article.setAttribute("aria-label", spec.title);

      const header = element("header", "window-titlebar");
      const title = element("span", "", spec.title);
      header.append(title, element("span", "window-marks"));
      const body = spec.body ? spec.body() : element("div", "wm-app-body");
      const status = element("footer", "app-statusline");
      (spec.status ?? []).forEach((label) => status.append(element("span", "", label)));
      status.append(element("span", "status-fill", ""));
      article.append(header, body, status);
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

      const instance = spec.create({
        body,
        statusline: status,
        title,
        wm,
        close: () => {
          tree.setFocus(ws, id);
          wm.kill();
        },
      });
      apps.set(id, instance ?? {});
      paint({ announceText: `${spec.title} opened`, toast: { text: `exec ${appName}`, key: "exec" } });
      renderer.renderNow();
      instance?.focus?.();
      return true;
    },

    runCommand(text) {
      const command = String(text ?? "").trim().toLowerCase();
      if (!command) return "empty command";
      const [head, ...rest] = command.split(/\s+/);
      const argument = rest.join(" ");
      if (head === "layout") return wm.setLayout(argument.replace(" ", "")) ? "" : "no change";
      if (head === "split") return wm.split(argument.startsWith("v") ? "v" : "h") ? "" : "no change";
      if (head === "fullscreen") return wm.toggleFullscreen() ? "" : "no window";
      if (head === "kill") return wm.kill() ? "" : "no window";
      if (head === "floating") return wm.toggleFloating() ? "" : "no window";
      if (head === "restart") return wm.restart() ? "" : "";
      if (head === "exec") return wm.spawn(argument) ? "" : `unknown program: ${argument}`;
      if (head === "workspace") {
        const index = Number.parseInt(argument, 10);
        if (Number.isFinite(index)) {
          onWorkspaceRequest(index);
          return "";
        }
        wm.openWorkspace(argument);
        return "";
      }
      if (head === "move") {
        const index = Number.parseInt(rest[rest.length - 1], 10);
        return Number.isFinite(index) ? (wm.moveToWorkspaceIndex(index) ? "" : "no window") : "usage: move to workspace N";
      }
      return `unknown command: ${head}`;
    },

    onModeChange: (mode) => {
      bar.setMode(mode);
      if (mode !== "default") dunst.notify(`mode ${mode}`, { key: "mode" });
    },

    commands() {
      const list = [
        { label: "layout tabbed", aliases: "tab tabs w", run: () => wm.setLayout("tabbed") },
        { label: "layout stacked", aliases: "stack s", run: () => wm.setLayout("stacked") },
        { label: "layout splith", aliases: "horizontal", run: () => wm.setLayout("splith") },
        { label: "layout splitv", aliases: "vertical", run: () => wm.setLayout("splitv") },
        { label: "split h", aliases: "split horizontal b", run: () => wm.split("h") },
        { label: "split v", aliases: "split vertical", run: () => wm.split("v") },
        { label: "fullscreen", aliases: "f max", run: () => wm.toggleFullscreen() },
        { label: "floating toggle", aliases: "float drag", run: () => wm.toggleFloating() },
        { label: "kill window", aliases: "q close", run: () => wm.kill() },
        { label: "restore all windows", aliases: "unkill undo", run: () => wm.restoreAll() },
        { label: "restart i3 inplace", aliases: "reset reload", run: () => wm.restart() },
        { label: "scratchpad show", aliases: "minimize", run: () => wm.scratchpadShow() },
        { label: "resize mode", aliases: "r", run: () => keys.setMode("resize") },
      ];
      WORKSPACES.forEach((name, index) => {
        list.push({
          label: `move to workspace ${index + 1}:${name}`,
          aliases: `move ${name} ${index + 1}`,
          run: () => wm.moveToWorkspaceIndex(index + 1),
        });
      });
      APP_NAMES.forEach((name) => {
        list.push({ label: `exec ${name}`, aliases: `run open ${APPS[name].label}`, run: () => wm.spawn(name) });
      });
      WALLPAPERS.forEach((name) => {
        list.push({ label: `wallpaper ${name}`, aliases: `feh background ${name}`, run: () => wm.setWallpaper(name) });
      });
      list.push(
        { label: "exec i3lock", aliases: "lock screen", run: () => lock?.lock() },
        { label: "lock off", aliases: "idle disable", run: () => { prefs.lock = "off"; lock?.reschedule(); announce("idle lock off"); } },
        { label: "lock 10m", aliases: "idle ten", run: () => { prefs.lock = "10m"; lock?.reschedule(); announce("idle lock ten minutes"); } },
        { label: "lock 30m", aliases: "idle thirty", run: () => { prefs.lock = "30m"; lock?.reschedule(); announce("idle lock thirty minutes"); } },
        { label: "boot on", aliases: "greeter lightdm enable", run: () => { prefs.boot = true; announce("boot sequence on"); } },
        { label: "boot off", aliases: "greeter lightdm disable", run: () => { prefs.boot = false; announce("boot sequence off"); } },
        { label: "log out", aliases: "logout exit session lightdm sign out", run: () => wm.logout() },
        { label: "exec lightdm", aliases: "replay greeter boot sequence", run: () => showGreeter("boot") },
        { label: "notify off", aliases: "dunst quiet", run: () => { prefs.notify = false; announce("notifications off"); } },
        { label: "notify on", aliases: "dunst", run: () => { prefs.notify = true; dunst.notify("dunst enabled", { key: "dunst" }); } },
        { label: "exit i3 (plain page)", aliases: "plain disable wm document", run: () => wm.setEnabled(false) },
      );
      return list;
    },

    bindings: () => keys.bindings(),
    resizeBindings: () => keys.resizeBindings(),

    isEnabled,

    setEnabled(next) {
      enabled = Boolean(next);
      prefs.enabled = enabled;
      root.dataset.wm = enabled ? "on" : "off";
      root.classList.remove("wm-dragging");
      const toggle = document.querySelector("#wm-toggle");
      if (toggle) {
        toggle.setAttribute("aria-pressed", String(enabled));
        const label = toggle.querySelector(".tray-label");
        if (label) label.textContent = enabled ? "i3" : "plain";
      }
      /* Clear any half-made selection and any drag cursor left on the layers,
         so the two modes never leak state into one another. */
      const selection = window.getSelection?.();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
      for (const layer of layers.values()) layer.style.cursor = "";

      if (enabled) {
        root.classList.add("wm-active");
        renderer.invalidate();
        renderer.renderNow();
        announce("i3 window manager");
      } else {
        root.classList.remove("wm-active");
        renderer.destroy();
        keys.setMode("default");
        announce("plain document mode");
      }
      toggle?.focus({ preventScroll: true });
      return enabled;
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      keys.destroy();
      pointer.destroy();
      bar.destroy();
      dunst.destroy();
      lock?.destroy();
      touch?.destroy();
      renderer.destroy();
      root.classList.remove("wm-active");
    },
  };

  const keys = installKeys({ wm, isBlocked: blocked, onWorkspaceRequest, openLauncher });
  const pointer = installPointer({
    wm,
    layers,
    decos,
    getLayout: (name) => renderer.getLayout(name),
    getActive: () => active,
    isEnabled,
  });

  let lock = null;
  let touch = null;
  let greeterInstance = null;

  const showGreeter = (mode) => {
    import("./greeter.js?v=20260904").then(({ runGreeter }) => {
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
      startSession();
      clearGreetFlag();
    });
  };

  /* Title bar buttons: the decorative marks become real controls. */
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-wm-action]");
    if (!button) return;
    const id = button.closest("[data-wm-window]")?.dataset.wmWindow;
    if (!id) return;
    event.preventDefault();
    wm.focusWindow(id, { moveBrowserFocus: false });
    if (button.dataset.wmAction === "close") wm.kill();
    else if (button.dataset.wmAction === "maximize") wm.toggleFullscreen();
    else wm.scratchpadMove();
  });

  document.addEventListener("click", (event) => {
    const restore = event.target.closest?.("[data-wm-restore]");
    if (!restore) return;
    event.preventDefault();
    wm.restoreAll();
    renderer.renderNow();
    restoreFocus(null);
  });

  /* Tablist keyboard support: the tab strip is one tab stop with arrow keys. */
  document.addEventListener("keydown", (event) => {
    const tab = event.target.closest?.(".wm-tab");
    if (!tab) return;
    const bar = tab.parentElement;
    const tabs = [...bar.children];
    const index = tabs.indexOf(tab);
    const map = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    const next = map[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    target?.click();
    target?.focus({ preventScroll: true });
  });

  document.addEventListener("wm:focus-window", (event) => {
    const id = event.detail?.id;
    if (id && windows.has(id)) wm.focusWindow(id);
  });

  const onResize = () => {
    if (reapplyResponsiveDefaults(state, { mobile: media.mobile.matches })) save();
    renderer.invalidate();
    renderer.renderNow();
  };
  window.addEventListener("resize", onResize, { passive: true });
  media.mobile.addEventListener?.("change", onResize);

  const visualViewport = window.visualViewport;
  visualViewport?.addEventListener("resize", () => {
    root.style.setProperty("--vv-height", `${visualViewport.height}px`);
    root.style.setProperty("--vv-offset", `${visualViewport.offsetTop}px`);
  });

  root.dataset.wallpaper = state.wallpaper;
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
      close: () => {
        tree.setFocus(state.workspaces.home, "home-terminal");
        wm.kill();
      },
    }));
  }

  attachHomeShell();

  if (media.coarse.matches) {
    import("./touch.js?v=20260904")
      .then(({ installTouch }) => {
        touch = installTouch({ shell, wm, isBlocked: blocked });
      })
      .catch(() => {});
  }

  import("./idle-lock.js?v=20260904")
    .then(({ installIdleLock }) => {
      lock = installIdleLock({
        node: document.querySelector("#lockscreen"),
        isBusy: () => isBlocked() || Boolean(greeterInstance),
        onLock: () => dunst.notify("i3lock", { key: "lock" }),
      });
    })
    .catch(() => {});

  if (shouldGreet() && prefs.boot) showGreeter("boot");
  else startSession();

  if (isSelfTest()) {
    import("./selftest.js?v=20260904")
      .then(({ runSelfTest }) => runSelfTest())
      .catch((error) => console.error("[wm] selftest failed to load", error));
  }

  if (params.get("wm") === "off") wm.setEnabled(false);

  return wm;
};
