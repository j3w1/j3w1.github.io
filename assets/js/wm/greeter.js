/* The boot sequence and the LightDM greeter.

   Two phases. The boot log scrolls (skippable with any key), then the login
   panel appears and *waits* — it never logs itself in. Logging in stores a
   session, so a returning visitor goes straight to the desktop until they log
   out again; logging out returns to the greeter without replaying the boot.

   The panel is interactive by design, so unlike the lock screen it is neither
   inert nor aria-hidden: it is a labelled dialog with a real focusable button.
   It still never touches <main>, never traps focus, and never runs when the
   visitor arrived at a deep link, when a session already exists, or under
   automation — see the inline decision script in index.html.

   The log lines and the player live in console.js, shared with the power
   sequences; this module owns only the two greeter phases. */

import { BOOT_BANNER, BOOT_LOG, playLines } from "./console.js?v=20260905g";

const HINT_AT = 900;
const DOTS = 11;
const DOT_MS = 42;

export const runGreeter = ({ node, mode = "boot", reducedMotion, onLogin, lines = BOOT_LOG }) => {
  if (!node) {
    onLogin({ silent: true });
    return { destroy() {} };
  }

  const bootScreen = node.querySelector("[data-boot-screen]");
  const loginScreen = node.querySelector("[data-login-screen]");
  const banner = node.querySelector("[data-banner]");
  const log = node.querySelector("[data-log]");
  const hint = node.querySelector("[data-hint]");
  const dots = node.querySelector("[data-dots]");
  const auth = node.querySelector("[data-auth]");
  const loginButton = node.querySelector("[data-login]");

  let player = null;
  let dotTimer = 0;
  let finished = false;
  let phase = mode === "login" ? "login" : "boot";
  const timers = new Set();

  /* Every timeout is tracked so destroy() during authentication cannot land in
     finish() and log a visitor in after the greeter was torn down. */
  const later = (callback, delay) => {
    const id = setTimeout(() => {
      timers.delete(id);
      callback();
    }, delay);
    timers.add(id);
    return id;
  };

  const cleanup = () => {
    player?.cancel();
    player = null;
    if (dotTimer) clearInterval(dotTimer);
    for (const id of timers) clearTimeout(id);
    timers.clear();
    dotTimer = 0;
    window.removeEventListener("keydown", onKeydown, true);
    node.removeEventListener("pointerdown", onPointerDown);
    loginButton?.removeEventListener("click", authenticate);
  };

  /* A replay (log out, then log in; `exec lightdm`) starts from a clean screen
     rather than appending a second boot log under the first. */
  banner?.replaceChildren();
  log?.replaceChildren();
  if (bootScreen) bootScreen.hidden = false;
  if (loginScreen) loginScreen.hidden = true;
  if (hint) hint.hidden = true;
  if (auth) auth.textContent = "";
  if (dots) dots.textContent = "";
  node.classList.remove("is-leaving");
  delete node.dataset.phase;

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    node.classList.add("is-leaving");
    const hide = () => {
      node.hidden = true;
      node.classList.remove("is-leaving");
      document.documentElement.classList.remove("wm-greeting");
      onLogin({ silent: false });
    };
    if (reducedMotion) hide();
    else later(hide, 240);
  };

  const authenticate = () => {
    if (phase !== "login" || finished) return;
    phase = "authenticating";
    if (auth) auth.textContent = "authenticating…";
    if (hint) hint.hidden = true;
    later(() => {
      if (auth) auth.textContent = "authentication succeeded";
      later(finish, reducedMotion ? 0 : 260);
    }, reducedMotion ? 0 : 340);
  };

  /* The password field is decoration: a fixed run of bullets, filled by a timer.
     There is no password value anywhere in the source, and nothing is checked. */
  const showLogin = () => {
    phase = "login";
    player = null;
    if (bootScreen) bootScreen.hidden = true;
    if (loginScreen) loginScreen.hidden = false;
    if (hint) {
      hint.hidden = false;
      hint.textContent = "press enter to log in";
    }
    if (dots) {
      if (reducedMotion) {
        dots.textContent = "•".repeat(DOTS);
      } else {
        let filled = 0;
        dotTimer = setInterval(() => {
          filled += 1;
          dots.textContent = "•".repeat(filled);
          if (filled >= DOTS) {
            clearInterval(dotTimer);
            dotTimer = 0;
          }
        }, DOT_MS);
      }
    }
    loginButton?.focus({ preventScroll: true });
  };

  const skipBoot = () => {
    if (player) player.skip();
    else showLogin();
  };

  function onKeydown(event) {
    if (finished) return;
    if (phase === "boot") {
      event.preventDefault();
      skipBoot();
      return;
    }
    /* Only Enter logs in. Any other key during the login phase is ignored, so
       the panel cannot be dismissed by accident. */
    if (phase === "login" && event.key === "Enter") {
      event.preventDefault();
      authenticate();
    }
  }

  /* Clicking anywhere skips the boot log, but the login panel only responds to
     the Log In button itself — a stray click on the desktop behind it must not
     log anyone in. */
  function onPointerDown() {
    if (finished || phase !== "boot") return;
    skipBoot();
  }

  node.hidden = false;
  document.documentElement.classList.add("wm-greeting");
  window.addEventListener("keydown", onKeydown, true);
  node.addEventListener("pointerdown", onPointerDown);
  loginButton?.addEventListener("click", authenticate);

  if (phase === "login") {
    showLogin();
  } else {
    player = playLines({
      banner,
      log,
      bannerLines: BOOT_BANNER,
      lines,
      instant: Boolean(reducedMotion),
      onProgress: (elapsed) => {
        if (elapsed >= HINT_AT && hint?.hidden) hint.hidden = false;
      },
      onDone: showLogin,
    });
  }

  return {
    destroy: () => {
      cleanup();
      node.hidden = true;
      document.documentElement.classList.remove("wm-greeting");
    },
  };
};
