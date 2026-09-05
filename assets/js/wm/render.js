/* The only module that writes geometry to the DOM.

   Authored windows are never created, cloned, moved, or removed here — only
   their style, hidden, class and ARIA attributes are touched. Everything the
   window manager draws for itself lives in the per-workspace .wm-deco layer. */

import { computeWorkspace, GEOMETRY } from "./layout.js?v=20260905d";
import { isTabular } from "./tree.js?v=20260905d";
import { element, rafBatch, readPx, sameRect } from "./dom.js?v=20260905d";

const GRIPS = Object.freeze(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);

export const createRenderer = ({ windows, layers, decos, empties, getState, getActive, gap }) => {
  const rects = new Map();
  const layouts = new Map();
  const tabbars = new Map();
  let grips = null;

  const windowId = (id) => {
    const node = windows.get(id);
    if (!node) return null;
    if (!node.id) node.id = `wm-win-${id}`;
    return node.id;
  };

  const applyRect = (id, rect, zIndex) => {
    const node = windows.get(id);
    if (!node) return;
    if (!sameRect(rects.get(id), rect)) {
      node.style.left = `${rect.x}px`;
      node.style.top = `${rect.y}px`;
      node.style.width = `${rect.w}px`;
      node.style.height = `${rect.h}px`;
      rects.set(id, rect);
    }
    if (node.hidden) node.hidden = false;
    node.style.zIndex = String(zIndex);
  };

  const clearTabSemantics = (node) => {
    if (!node) return;
    node.removeAttribute("role");
    node.removeAttribute("aria-labelledby");
  };

  /* Tab bars are real tablists, not decoration: they are the only way to reach a
     hidden tab child with a keyboard. Inactive panels keep their aria-label and
     gain role="tabpanel" only while a tabbed container actually exists. */
  const renderDeco = (wsName, layer, result, state) => {
    const ws = state.workspaces[wsName];
    const seen = new Set();
    const store = tabbars.get(wsName) ?? new Map();
    tabbars.set(wsName, store);

    for (const deco of result.decos) {
      seen.add(deco.conId);
      let bar = store.get(deco.conId);
      if (!bar) {
        bar = element("div", "wm-tabbar");
        bar.setAttribute("role", "tablist");
        bar.dataset.wmCon = deco.conId;
        layer.append(bar);
        store.set(deco.conId, bar);
      }
      bar.className = `wm-tabbar wm-tabbar-${deco.kind}`;
      bar.setAttribute("aria-label", `${wsName} windows`);
      bar.style.left = `${deco.rect.x}px`;
      bar.style.top = `${deco.rect.y}px`;
      bar.style.width = `${deco.rect.w}px`;
      bar.style.height = `${deco.rect.h}px`;

      const buttons = [...bar.children];
      deco.tabs.forEach((tab, index) => {
        let button = buttons[index];
        if (!button) {
          button = element("button", "wm-tab");
          button.type = "button";
          button.setAttribute("role", "tab");
          bar.append(button);
        }
        const target = windows.get(tab.id);
        button.dataset.wmTab = tab.id ?? "";
        button.dataset.wmCon = deco.conId;
        button.dataset.wmIndex = String(tab.childIndex);
        button.textContent = target?.dataset.wmTitle ?? tab.id ?? "window";
        button.classList.toggle("is-active", tab.active);
        button.setAttribute("aria-selected", String(tab.active));
        button.tabIndex = tab.active ? 0 : -1;
        button.style.left = `${tab.rect.x - deco.rect.x}px`;
        button.style.top = `${tab.rect.y - deco.rect.y}px`;
        button.style.width = `${tab.rect.w}px`;
        button.style.height = `${tab.rect.h}px`;
        if (target) {
          const id = windowId(tab.id);
          /* Recycled buttons must not keep an id minted for another window. */
          button.id = `wm-tab-${tab.id}`;
          button.setAttribute("aria-controls", id);
          target.setAttribute("role", "tabpanel");
          target.setAttribute("aria-labelledby", button.id);
        }
      });
      while (bar.children.length > deco.tabs.length) bar.lastElementChild.remove();
    }

    for (const [conId, bar] of store) {
      if (seen.has(conId)) continue;
      bar.remove();
      store.delete(conId);
    }

    /* Any window not currently a tab child must lose its tabpanel semantics. */
    const tabbed = new Set(result.decos.flatMap((deco) => deco.tabs.map((tab) => tab.id)));
    for (const id of windows.keys()) {
      if (!tabbed.has(id)) clearTabSemantics(windows.get(id));
    }

    renderGrips(layer, ws, result);
  };

  const renderGrips = (layer, ws, result) => {
    const focused = ws.focusMode === "floating" ? ws.focused : null;
    const rect = focused ? result.floats.get(focused) : null;
    if (!grips || grips.layer !== layer) {
      grips?.node.remove();
      const node = element("div", "wm-grips");
      node.setAttribute("aria-hidden", "true");
      GRIPS.forEach((side) => {
        const grip = element("span", `wm-grip wm-grip-${side}`);
        grip.dataset.wmGrip = side;
        node.append(grip);
      });
      layer.append(node);
      grips = { layer, node };
    }
    if (!rect) {
      grips.node.hidden = true;
      return;
    }
    grips.node.hidden = false;
    grips.node.dataset.wmTarget = focused;
    grips.node.style.left = `${rect.x}px`;
    grips.node.style.top = `${rect.y}px`;
    grips.node.style.width = `${rect.w}px`;
    grips.node.style.height = `${rect.h}px`;
  };

  const measure = (wsName) => {
    const layer = layers.get(wsName);
    if (!layer) return null;
    const width = layer.clientWidth;
    const height = layer.clientHeight;
    if (!width || !height) return null;
    return { x: 0, y: 0, w: width, h: height };
  };

  const renderNow = () => {
    const state = getState();
    const wsName = getActive();
    const ws = state?.workspaces?.[wsName];
    if (!ws) return;
    const layer = layers.get(wsName);
    const deco = decos.get(wsName);
    const bounds = measure(wsName);
    if (!layer || !bounds) return;

    const geometry = {
      ...GEOMETRY,
      gapInner: gap(),
      tabHeight: readPx("--wm-tab-height", GEOMETRY.tabHeight),
      stackRow: readPx("--wm-stack-row", GEOMETRY.stackRow),
    };
    const result = computeWorkspace(ws, bounds, geometry);
    layouts.set(wsName, result);

    /* Every window that is not part of the active workspace is hidden, whichever
       section it was authored in: inactive sections are only visibility:hidden,
       and a window that has been moved to this workspace lives in another
       section's DOM. This is also what keeps the accessibility tree honest. */
    for (const [id, node] of windows) {
      if (!result.tiles.has(id) && !result.floats.has(id)) {
        if (!node.hidden) node.hidden = true;
        node.classList.remove("is-focused");
        rects.delete(id);
      }
    }

    for (const [id, rect] of result.tiles) applyRect(id, rect, 1);
    ws.floating.forEach((node, index) => {
      const rect = result.floats.get(node.id);
      if (rect) applyRect(node.id, rect, 10 + index);
    });
    if (ws.fullscreen) applyRect(ws.fullscreen, result.tiles.get(ws.fullscreen), 70);

    for (const [id, node] of windows) {
      node.classList.toggle("is-focused", id === ws.focused && !node.hidden);
      node.classList.toggle("is-floating", ws.floating.some((leaf) => leaf.id === id));
    }

    if (deco) renderDeco(wsName, deco, result, state);

    const empty = empties.get(wsName);
    if (empty) {
      const isEmpty = result.tiles.size === 0 && result.floats.size === 0;
      empty.hidden = !isEmpty;
      const label = empty.querySelector("[data-empty-ws]");
      if (label && isEmpty) label.textContent = wsName;
    }
  };

  const schedule = rafBatch(renderNow);

  return {
    schedule,
    renderNow,
    measure,
    getLayout: (wsName) => layouts.get(wsName ?? getActive()) ?? null,
    invalidate: () => rects.clear(),
    destroy: () => {
      for (const store of tabbars.values()) {
        for (const bar of store.values()) bar.remove();
      }
      tabbars.clear();
      grips?.node.remove();
      grips = null;
      for (const [id, node] of windows) {
        node.removeAttribute("style");
        node.hidden = false;
        node.classList.remove("is-focused", "is-floating");
        clearTabSemantics(node);
        rects.delete(id);
      }
      for (const empty of empties.values()) empty.hidden = true;
    },
  };
};

export { isTabular };
