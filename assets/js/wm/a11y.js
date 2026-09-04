/* The accessibility contract, in code.

   One live region in the chrome (#workspace-announcer). Focus is never allowed
   to fall to <body>: doing so resets a screen reader's virtual cursor to the top
   of the document and the reader loses their place entirely, which is the least
   visible and most damaging failure this window manager could produce. */

let announcer = null;
let pending = null;
let timer = 0;

export const installAnnouncer = (node) => {
  announcer = node;
};

export const announce = (message) => {
  if (!announcer || !message) return;
  pending = message;
  if (timer) return;
  timer = setTimeout(() => {
    timer = 0;
    if (announcer && pending) announcer.textContent = pending;
    pending = null;
  }, 150);
};

/* Next visible window in the workspace, then the workspace section (which
   already carries tabindex="-1"), then the main region. Never <body>. */
export const refocus = ({ candidates = [], section, main }) => {
  for (const candidate of candidates) {
    if (candidate instanceof HTMLElement && !candidate.hidden && candidate.isConnected) {
      candidate.focus({ preventScroll: true });
      return candidate;
    }
  }
  const fallback = section ?? main ?? document.querySelector("#main-content");
  if (fallback instanceof HTMLElement) {
    fallback.focus({ preventScroll: true });
    return fallback;
  }
  return null;
};

/* True when focus currently sits inside something that is about to be hidden. */
export const focusIsInside = (node) =>
  node instanceof HTMLElement &&
  document.activeElement instanceof HTMLElement &&
  (node === document.activeElement || node.contains(document.activeElement));

export const describeWindow = (node) =>
  node?.dataset?.wmTitle ?? node?.getAttribute?.("aria-label") ?? "window";
