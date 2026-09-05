/* dunst-style toasts.

   Visual only: the container is aria-hidden and inert. Every window manager
   event also calls announce() from a11y.js, which is the single live region in
   the chrome. If this were a live region too, a screen reader would hear each
   event twice, in terse i3 jargon — so the announcer speaks human sentences and
   dunst shows the short form. */

import { element } from "./dom.js?v=20260905j";
import { media, prefs } from "./session.js?v=20260905j";

/* dunstrc: geometry "0x4-25+25" — at most four toasts. The window manager's
   own event toasts are short-lived (i3 itself never toasts a layout change;
   these are the site's invention); application toasts — the notify-send calls
   the original config made on every border change — keep dunstrc's 10 s, and
   a critical one stays until dismissed. */
const MAX_VISIBLE = 4;
const MIN_INTERVAL = 400;
const TIMEOUT = 2600;
const APP_TIMEOUT = 10000;

export const installNotify = ({ container }) => {
  const live = new Map();
  let last = 0;

  const dismiss = (key) => {
    const entry = live.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.node.remove();
    live.delete(key);
  };

  /* format "%s %p\n%b": a summary line, and an optional body line below it. */
  const notify = (message, { key = message, urgency = "normal", body = "", timeout } = {}) => {
    if (!container || !prefs.notify || !message) return;
    const now = Date.now();
    if (urgency !== "critical" && now - last < MIN_INTERVAL && !live.has(key)) return;
    last = now;

    let entry = live.get(key);
    if (!entry) {
      const node = element("div", "dunst-toast");
      node.dataset.block = key;
      node.append(element("span", "dunst-summary"), element("span", "dunst-body"));
      container.append(node);
      entry = { node, timer: 0 };
      live.set(key, entry);
    }
    entry.node.classList.toggle("is-critical", urgency === "critical");
    entry.node.classList.toggle("is-low", urgency === "low");
    entry.node.firstChild.textContent = message;
    entry.node.lastChild.textContent = body;
    entry.node.lastChild.hidden = !body;

    /* Never sequence on transitionend: the reduced-motion block forces a 0.01ms
       duration and such handlers stop firing reliably. */
    clearTimeout(entry.timer);
    if (urgency === "critical") {
      entry.timer = 0;
    } else {
      const base = timeout ?? TIMEOUT;
      entry.timer = setTimeout(() => dismiss(key), media.reducedMotion.matches && !timeout ? base * 1.5 : base);
    }

    while (live.size > MAX_VISIBLE) dismiss(live.keys().next().value);
  };

  /* dunstctl close-all, and the Ctrl+Space dunst binds to `close`. */
  const closeAll = () => {
    for (const key of [...live.keys()]) dismiss(key);
  };

  const onClick = (event) => {
    const toast = event.target.closest?.(".dunst-toast");
    if (toast) dismiss(toast.dataset.block);
  };

  container?.addEventListener("click", onClick);

  return {
    notify,
    closeAll,
    appTimeout: APP_TIMEOUT,
    destroy() {
      container?.removeEventListener("click", onClick);
      for (const key of [...live.keys()]) dismiss(key);
    },
  };
};
