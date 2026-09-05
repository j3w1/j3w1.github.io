/* Pointer interaction: click to focus, drag title bars, resize floating windows,
   drag the gutter between tiles.

   The discipline that keeps ordinary clicking working: a drag only starts from a
   title bar, a grip, a gutter, or Alt+pointerdown, and it must cross a 4px
   threshold before it commits. Below that threshold nothing is preventDefault-ed,
   so link clicks, table row selection, form fields and text selection inside the
   terminal buffers all behave exactly as they did before. */

import { gutterAt } from "./layout.js?v=20260905h";
import { element } from "./dom.js?v=20260905h";
import { media } from "./session.js?v=20260905h";

const THRESHOLD = 4;
const PROXY_FRACTION = 0.5;
const PROXY_MAX = { w: 760, h: 540 };

/* A tiled or fullscreen window is far too large to steer around by its title
   bar, so the drag carries the size the window will actually become once it
   floats. The grab point keeps its relative position, so the cursor stays where
   it was on the title bar instead of jumping to a corner. */
const proxyRect = (rect, bounds, point) => {
  const width = Math.round(Math.min(rect.w, bounds.w * PROXY_FRACTION, PROXY_MAX.w));
  const height = Math.round(Math.min(rect.h, bounds.h * PROXY_FRACTION, PROXY_MAX.h));
  if (width === rect.w && height === rect.h) return { ...rect };
  const ratioX = rect.w ? (point.x - rect.x) / rect.w : 0.5;
  const ratioY = rect.h ? (point.y - rect.y) / rect.h : 0.5;
  return {
    x: Math.round(point.x - width * ratioX),
    y: Math.round(point.y - height * ratioY),
    w: width,
    h: height,
  };
};

export const installPointer = ({ wm, layers, decos, getLayout, getActive, isEnabled }) => {
  let drag = null;
  let ghost = null;
  let cursorAt = 0;

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
    /* In plain document mode there is no window manager to drive: leaving these
       handlers live made ordinary text selection fight a half-started drag. */
    if (!isEnabled() || event.button !== 0 || drag) return;
    const wsName = getActive();
    const layer = layers.get(wsName);
    if (!layer || !layer.contains(event.target)) return;

    /* Tabs activate on click (below), which mouse, touch, and a keyboard's
       Enter or Space all produce; pointerdown only has to keep a drag from
       starting on the strip. */
    if (event.target.closest?.(".wm-tab")) return;

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
      const bounds = { x: 0, y: 0, w: layer.clientWidth, h: layer.clientHeight };
      drag = {
        kind: "move",
        id,
        origin: point,
        rect: proxyRect(rect, bounds, point),
        wsName,
        live: false,
      };
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
    /* Clear anything the first few pixels managed to highlight before the drag
       was recognised, so no stray selection survives the gesture. */
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) selection.removeAllRanges();
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
      wm.placeFloating(finished.id, {
        ...finished.rect,
        x: finished.rect.x + finished.delta.dx,
        y: finished.rect.y + finished.delta.dy,
      });
    } else if (finished.kind === "resize" && finished.next) {
      wm.resizeFloating(finished.id, finished.next);
    } else if (finished.kind === "gutter" && finished.delta) {
      const horizontal = finished.gutter.orientation === "h";
      wm.dragGutter(finished.gutter, horizontal ? finished.delta.dx : finished.delta.dy);
    }
  };

  /* Hit-testing the gutters reads layout, so it is throttled and skipped
     entirely when the window manager is off. */
  const onCursor = (event) => {
    if (drag || !isEnabled()) return;
    const now = event.timeStamp || Date.now();
    if (now - cursorAt < 40) return;
    cursorAt = now;
    const wsName = getActive();
    const layer = layers.get(wsName);
    if (!layer || !layer.contains(event.target)) return;
    const layout = getLayout(wsName);
    if (!layout) return;
    const gutter = gutterAt(layout, pointIn(layer, event), media.coarse.matches ? 16 : 6);
    layer.style.cursor = gutter ? (gutter.orientation === "h" ? "col-resize" : "row-resize") : "";
  };

  const onClick = (event) => {
    if (!isEnabled()) return;
    const tab = event.target.closest?.(".wm-tab");
    if (!tab || !layers.get(getActive())?.contains(tab)) return;
    wm.focusTab(tab.dataset.wmCon, Number(tab.dataset.wmIndex), tab.dataset.wmTab);
  };

  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("click", onClick);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
  document.addEventListener("lostpointercapture", finish);
  document.addEventListener("pointermove", onCursor, { passive: true });

  /* A long press floats the window under the finger while the title-bar drag
     that began on pointerdown is still in progress; rebasing that drag onto the
     new floating rect lets the same gesture carry the window away. */
  const rebaseDrag = (id) => {
    if (!drag || drag.kind !== "move" || drag.id !== id) return false;
    const rect = getLayout(drag.wsName)?.floats.get(id);
    if (rect) drag.rect = rect;
    return true;
  };

  return {
    rebaseDrag,
    destroy: () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      document.removeEventListener("lostpointercapture", finish);
      document.removeEventListener("pointermove", onCursor);
      ghost?.remove();
      ghost = null;
    },
  };
};
