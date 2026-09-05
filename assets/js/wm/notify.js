/* dunst-style toasts.

   Visual only: the container is aria-hidden and inert. Every window manager
   event also calls announce() from a11y.js, which is the single live region in
   the chrome. If this were a live region too, a screen reader would hear each
   event twice, in terse i3 jargon — so the announcer speaks human sentences and
   dunst shows the short form. */

import { element } from "./dom.js?v=20260905e";
import { media, prefs } from "./session.js?v=20260905e";

const MAX_VISIBLE = 3;
const MIN_INTERVAL = 400;
const TIMEOUT = 2600;
const CRITICAL_TIMEOUT = 6000;

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

  const notify = (message, { key = message, urgency = "normal" } = {}) => {
    if (!container || !prefs.notify || !message) return;
    const now = Date.now();
    if (urgency !== "critical" && now - last < MIN_INTERVAL && !live.has(key)) return;
    last = now;

    let entry = live.get(key);
    if (!entry) {
      const node = element("div", "dunst-toast");
      node.dataset.block = key;
      container.append(node);
      entry = { node, timer: 0 };
      live.set(key, entry);
    }
    entry.node.classList.toggle("is-critical", urgency === "critical");
    entry.node.textContent = message;

    /* Never sequence on transitionend: the reduced-motion block forces a 0.01ms
       duration and such handlers stop firing reliably. */
    clearTimeout(entry.timer);
    if (urgency !== "critical") {
      entry.timer = setTimeout(() => dismiss(key), media.reducedMotion.matches ? TIMEOUT * 1.5 : TIMEOUT);
    } else {
      entry.timer = setTimeout(() => dismiss(key), CRITICAL_TIMEOUT);
    }

    while (live.size > MAX_VISIBLE) dismiss(live.keys().next().value);
  };

  const onClick = (event) => {
    const toast = event.target.closest?.(".dunst-toast");
    if (toast) dismiss(toast.dataset.block);
  };

  container?.addEventListener("click", onClick);

  return {
    notify,
    destroy() {
      container?.removeEventListener("click", onClick);
      for (const key of [...live.keys()]) dismiss(key);
    },
  };
};
