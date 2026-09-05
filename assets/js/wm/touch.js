/* Touch gestures: swipe between workspaces, long-press a title bar to float.

   The guards are the whole feature. .project-table is min-width 760px inside
   .table-scroller, so a naive swipe handler would make the projects workspace —
   the most important page in a portfolio — unscrollable on every phone. Hence
   the scrollable-ancestor check, the 24px edge dead-zone that leaves iOS its
   back gesture, and a one-time axis lock biased towards vertical, because a
   scroll misread as a swipe is far worse than the reverse.

   pointermove is registered passive, so vertical scrolling can never be blocked
   or janked by this module. */

import { media } from "./session.js?v=20260905f";

const EDGE = 24;
const AXIS_AT = 10;
const AXIS_BIAS = 1.4;
const MIN_TRAVEL = 56;
const FLICK_VELOCITY = 0.5;
const FLICK_TRAVEL = 24;
const MAX_DURATION = 600;
const LONG_PRESS = 450;
const LONG_PRESS_SLOP = 8;

const scrollableBlocked = (target, root, direction) => {
  let node = target;
  while (node && node !== root && node instanceof HTMLElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") {
        const atStart = node.scrollLeft <= 0;
        const atEnd = node.scrollLeft >= node.scrollWidth - node.clientWidth - 1;
        if (direction > 0 ? !atStart : !atEnd) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
};

export const installTouch = ({ shell, wm, isBlocked }) => {
  let gesture = null;
  let press = null;

  const clearPress = () => {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
  };

  const reset = () => {
    if (gesture?.node) {
      gesture.node.style.transform = "";
      gesture.node.style.willChange = "";
    }
    gesture = null;
  };

  const onPointerDown = (event) => {
    if (event.pointerType !== "touch" || !event.isPrimary) return;
    if (gesture) {
      /* A second finger means pinch or zoom: the workspace swipe stands down. */
      reset();
      gesture = { abandoned: true };
      return;
    }
    if (isBlocked()) return;

    const titlebar = event.target.closest?.(".window-titlebar");
    if (titlebar && !event.target.closest?.("button")) {
      const id = titlebar.closest("[data-wm-window]")?.dataset.wmWindow;
      if (id) {
        press = {
          id,
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          timer: setTimeout(() => {
            press = null;
            if (!media.reducedMotion.matches) navigator.vibrate?.(12);
            wm.floatAndDrag(id, event.pointerId);
          }, LONG_PRESS),
        };
      }
    }

    if (event.clientX < EDGE || event.clientX > window.innerWidth - EDGE) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;

    gesture = {
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      axis: null,
      target: event.target,
      node: shell,
    };
  };

  const onPointerMove = (event) => {
    if (press) {
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (moved > LONG_PRESS_SLOP) clearPress();
    }
    if (!gesture || gesture.abandoned) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (!gesture.axis) {
      if (Math.hypot(dx, dy) < AXIS_AT) return;
      /* Decided once and never revisited for this pointer. */
      if (Math.abs(dx) < Math.abs(dy) * AXIS_BIAS) {
        gesture.abandoned = true;
        return;
      }
      if (scrollableBlocked(gesture.target, shell, dx)) {
        gesture.abandoned = true;
        return;
      }
      gesture.axis = "x";
      if (!media.reducedMotion.matches && gesture.node) gesture.node.style.willChange = "transform";
    }

    if (gesture.axis !== "x") return;
    if (media.reducedMotion.matches || !gesture.node) return;
    const resisted = wm.canSwipe(dx) ? dx * 0.35 : dx * 0.08;
    gesture.node.style.transform = `translate3d(${resisted}px, 0, 0)`;
  };

  const onPointerUp = (event) => {
    clearPress();
    if (!gesture || gesture.abandoned || gesture.axis !== "x") {
      reset();
      return;
    }
    const dx = event.clientX - gesture.startX;
    const elapsed = performance.now() - gesture.startedAt;
    const velocity = Math.abs(dx) / Math.max(elapsed, 1);
    const far = Math.abs(dx) >= Math.max(MIN_TRAVEL, window.innerWidth * 0.12);
    const flick = velocity >= FLICK_VELOCITY && Math.abs(dx) >= FLICK_TRAVEL;
    reset();
    if (elapsed > MAX_DURATION) return;
    if (far || flick) wm.swipeWorkspace(dx < 0 ? 1 : -1);
  };

  const onContextMenu = (event) => {
    if (media.coarse.matches && event.target.closest?.(".window-titlebar")) event.preventDefault();
  };

  document.addEventListener("pointerdown", onPointerDown, { passive: true });
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerup", onPointerUp, { passive: true });
  const onPointerCancel = () => {
    clearPress();
    reset();
  };
  document.addEventListener("pointercancel", onPointerCancel, { passive: true });
  document.addEventListener("contextmenu", onContextMenu);

  return {
    destroy: () => {
      clearPress();
      reset();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("contextmenu", onContextMenu);
    },
  };
};
