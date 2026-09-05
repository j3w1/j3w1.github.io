/* i3lock.

   The realistic risk on a portfolio is covering something somebody is halfway
   through reading, so the guards matter more than the effect: a ten minute floor,
   never on touch devices (where "idle" means "reading"), never under reduced
   motion, and suspended entirely while a dialog, the launcher, or a text field is
   active or the tab is in the background. It is dismissed by literally any input,
   asks for no password, and — like the greeter — is aria-hidden and inert, so it
   never moves focus in or out and <main> is untouched throughout. */

import { LOCK_THRESHOLDS, media, prefs } from "./session.js?v=20260905g";
import { throttle } from "./dom.js?v=20260905g";

/* Activity that counts as "still here" for the idle timer. Dismissing the
   lock is deliberately narrower — see onUnlockKey. */
const ACTIVITY = ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "touchstart"];

export const installIdleLock = ({ node, isBusy, onLock, onUnlock }) => {
  if (!node) return { lock() {}, destroy() {} };

  const timeNode = node.querySelector("[data-time]");
  const dateNode = node.querySelector("[data-date]");
  let timer = 0;
  let clock = 0;
  let locked = false;

  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "2-digit", month: "short" });
  const paint = () => {
    const now = new Date();
    if (timeNode) timeNode.textContent = timeFormat.format(now);
    if (dateNode) dateNode.textContent = dateFormat.format(now);
  };

  const unlock = () => {
    if (!locked) return;
    locked = false;
    node.hidden = true;
    if (clock) clearInterval(clock);
    clock = 0;
    document.documentElement.classList.remove("wm-locked");
    onUnlock?.();
    schedule();
  };

  const lock = () => {
    if (locked) return;
    locked = true;
    paint();
    node.hidden = false;
    document.documentElement.classList.add("wm-locked");
    clock = setInterval(paint, 60000);
    onLock?.();
  };

  const threshold = () => LOCK_THRESHOLDS[prefs.lock] ?? 0;

  const eligible = () =>
    threshold() > 0 &&
    !media.coarse.matches &&
    !media.reducedMotion.matches &&
    document.visibilityState === "visible";

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = 0;
    if (!eligible()) return;
    timer = setTimeout(() => {
      if (!eligible() || isBusy()) {
        schedule();
        return;
      }
      lock();
    }, threshold());
  };

  /* While unlocked this keeps the idle timer alive. It deliberately does not
     unlock: i3lock is dismissed by typing, and a passing mouse should not
     count as someone returning to the machine. */
  const onActivity = throttle(() => {
    if (!locked) schedule();
  }, 1000);

  const onUnlockKey = (event) => {
    if (!locked) return;
    /* Swallow the keystroke that dismisses the lock so it cannot also trigger a
       window manager binding underneath. */
    event.preventDefault();
    event.stopPropagation();
    unlock();
  };

  const onVisibility = () => {
    if (document.visibilityState !== "visible" && timer) clearTimeout(timer);
  };

  ACTIVITY.forEach((name) => document.addEventListener(name, onActivity, { passive: true }));
  document.addEventListener("keydown", onUnlockKey, true);
  document.addEventListener("visibilitychange", onVisibility);
  schedule();

  return {
    lock,
    unlock,
    reschedule: schedule,
    isLocked: () => locked,
    destroy: () => {
      if (timer) clearTimeout(timer);
      if (clock) clearInterval(clock);
      ACTIVITY.forEach((name) => document.removeEventListener(name, onActivity));
      document.removeEventListener("keydown", onUnlockKey, true);
      document.removeEventListener("visibilitychange", onVisibility);
      unlock();
    },
  };
};
