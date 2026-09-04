/* Pointer interaction: click to focus, drag title bars, resize floating windows,
   drag the gutter between tiles.

   The discipline that keeps ordinary clicking working: a drag only starts from a
   title bar, a grip, a gutter, or Alt+pointerdown, and it must cross a 4px
   threshold before it commits. Below that threshold nothing is preventDefault-ed,
   so link clicks, table row selection, form fields and text selection inside the
   terminal buffers all behave exactly as they did before. */

import { gutterAt, tabAt } from "./layout.js?v=20260904";
import { element } from "./dom.js?v=20260904";
import { media } from "./session.js?v=20260904";

const THRESHOLD = 4;

export const installPointer = ({ wm, layers, decos, getLayout, getActive }) => {
  let drag = null;
  let ghost = null;

  const ghostFor = (wsName) => {
    const layer = decos.get(wsName);
    if (!layer) return null;
    if (!ghost || ghost.parentElement !== layer) {
      ghost?.remove();
      ghost = element("div", "wm-drag-ghost");
      ghost.setAttribute("aria-hidden", "true");
      layer.append(ghost);
    }
    return ghost;
  };

  const showGhost = (wsName, rect) => {
    const node = ghostFor(wsName);
    if (!node) return;
    node.hidden = false;
    node.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`;
    node.style.width = `${rect.w}px`;
    node.style.height = `${rect.h}px`;
  };

  const hideGhost = () => {
    if (ghost) ghost.hidden = true;
  };

  const pointIn = (layer, event) => {
    const box = layer.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || drag) return;
    const wsName = getActive();
    const layer = layers.get(wsName);
    if (!layer || !layer.contains(event.target)) return;

    const tab = event.target.closest?.(".wm-tab");
    if (tab) {
      wm.focusTab(tab.dataset.wmCon, Number(tab.dataset.wmIndex), tab.dataset.wmTab);
      return;
    }

    const layout = getLayout(wsName);
    const point = pointIn(layer, event);
    const windowNode = event.target.closest?.("[data-wm-window]");
    const grip = event.target.closest?.("[data-wm-grip]");

    if (grip) {
      const id = grip.closest(".wm-grips")?.dataset.wmTarget;
      const rect = id ? layout?.floats.get(id) : null;
      if (!rect) return;
      drag = { kind: "resize", id, side: grip.dataset.wmGrip, origin: point, rect, wsName, live: false };
      layer.setPointerCapture?.(event.pointerId);
      return;
    }

    if (windowNode) {
      const id = windowNode.dataset.wmWindow;
      wm.focusWindow(id, { moveBrowserFocus: false });
      const onTitlebar = Boolean(event.target.closest?.(".window-titlebar")) &&
        !event.target.closest?.("button");
      if (!onTitlebar && !event.altKey) return;
      const rect = layout?.floats.get(id) ?? layout?.tiles.get(id);
      if (!rect) return;
      drag = { kind: "move", id, origin: point, rect, wsName, live: false };
      layer.setPointerCapture?.(event.pointerId);
      return;
    }

    if (layout) {
      const gutter = gutterAt(layout, point, media.coarse.matches ? 16 : 6);
      if (gutter) {
        drag = { kind: "gutter", gutter, origin: point, wsName, live: false, rect: gutter.rect };
        layer.setPointerCapture?.(event.pointerId);
      }
    }
  };

  const commitDrag = () => {
    document.documentElement.classList.add("wm-dragging");
    drag.live = true;
  };

  const onPointerMove = (event) => {
    if (!drag) return;
    const layer = layers.get(drag.wsName);
    if (!layer) return;
    const point = pointIn(layer, event);
    const dx = point.x - drag.origin.x;
    const dy = point.y - drag.origin.y;

    if (!drag.live) {
      if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      commitDrag();
    }
    event.preventDefault();

    if (drag.kind === "move") {
      showGhost(drag.wsName, { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy });
      drag.delta = { dx, dy };
      return;
    }
    if (drag.kind === "resize") {
      drag.next = resizeRect(drag.rect, drag.side, dx, dy);
      showGhost(drag.wsName, drag.next);
      return;
    }
    if (drag.kind === "gutter") {
      const horizontal = drag.gutter.orientation === "h";
      drag.delta = { dx, dy };
      showGhost(drag.wsName, {
        ...drag.gutter.rect,
        x: drag.gutter.rect.x + (horizontal ? dx : 0),
        y: drag.gutter.rect.y + (horizontal ? 0 : dy),
      });
    }
  };

  const resizeRect = (rect, side, dx, dy) => {
    let { x, y, w, h } = rect;
    if (side.includes("w")) {
      x += dx;
      w -= dx;
    }
    if (side.includes("e")) w += dx;
    if (side.includes("n")) {
      y += dy;
      h -= dy;
    }
    if (side.includes("s")) h += dy;
    return { x, y, w: Math.max(w, 160), h: Math.max(h, 96) };
  };

  const finish = (event) => {
    if (!drag) return;
    const layer = layers.get(drag.wsName);
    layer?.releasePointerCapture?.(event.pointerId);
    const finished = drag;
    drag = null;
    document.documentElement.classList.remove("wm-dragging");
    hideGhost();
    if (!finished.live) return;

    if (finished.kind === "move" && finished.delta) {
      wm.moveFloating(finished.id, finished.delta.dx, finished.delta.dy, finished.rect);
    } else if (finished.kind === "resize" && finished.next) {
      wm.resizeFloating(finished.id, finished.next);
    } else if (finished.kind === "gutter" && finished.delta) {
      const horizontal = finished.gutter.orientation === "h";
      wm.dragGutter(finished.gutter, horizontal ? finished.delta.dx : finished.delta.dy);
    }
  };

  const onCursor = (event) => {
    if (drag) return;
    const wsName = getActive();
    const layer = layers.get(wsName);
    if (!layer || !layer.contains(event.target)) return;
    const layout = getLayout(wsName);
    if (!layout) return;
    const gutter = gutterAt(layout, pointIn(layer, event), media.coarse.matches ? 16 : 6);
    layer.style.cursor = gutter ? (gutter.orientation === "h" ? "col-resize" : "row-resize") : "";
  };

  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
  document.addEventListener("lostpointercapture", finish);
  document.addEventListener("pointermove", onCursor, { passive: true });

  return {
    destroy: () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      document.removeEventListener("lostpointercapture", finish);
      document.removeEventListener("pointermove", onCursor);
      ghost?.remove();
      ghost = null;
    },
    tabAt,
  };
};
