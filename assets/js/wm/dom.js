/* Small shared helpers. site.js imports isEditable from here so there is one
   definition rather than two that can drift apart. */

export const isEditable = (element) =>
  element instanceof HTMLElement &&
  (element.matches("input, textarea, select") || element.isContentEditable);

export const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/* Registers a listener and returns the function that removes it, so every
   global handler a module installs can be torn down by the same list. */
export const listen = (target, type, handler, options) => {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
};

export const sameRect = (a, b) =>
  Boolean(a) && Boolean(b) && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/* Geometry constants live in CSS so the responsive breakpoints stay the single
   source of truth: the tab strip grows to a 44px touch target on phones without
   the layout code knowing anything about viewport widths. */
export const readPx = (name, fallback) => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
};

export const readGap = () => readPx("--gap", 3);

/* One frame in flight at a time: many mutations in a turn produce one paint. */
export const rafBatch = (run) => {
  let frame = 0;
  return () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      run();
    });
  };
};

export const throttle = (fn, interval) => {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last < interval) return;
    last = now;
    fn(...args);
  };
};
