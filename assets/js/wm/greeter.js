/* The LightDM greeter and systemd boot log.

   It is a curtain, never a gate. The markup is aria-hidden and inert from the
   first byte, <main> is never touched, and the whole sequence is capped at just
   over two seconds. Pressing Enter or clicking Log In gets you in immediately;
   any other key, click, tap or scroll skips it — without preventDefault, so the
   key that dismisses the greeter still does its normal job (pressing 2 both
   skips the boot and switches to 2:writing). If nobody touches anything, it logs
   in on its own, so it can never become something a visitor has to get past.

   Whether it runs at all was decided before first paint by the inline script in
   index.html: never on a deep link, never twice in a session, never under
   reduced motion, Save-Data, or automation. */

import { clearGreetFlag } from "./session.js?v=20260904";

const DOTS = 11;
const DOT_MS = 55;
const LOG_START = 900;
const LOG_STEP = 110;
const FADE_AT = 1800;
const DONE_AT = 2050;
const HINT_AT = 400;

const LOG = [
  "systemd[1]: Reached target Graphical Interface.",
  "systemd[1]: Started Light Display Manager.",
  "kernel: Loading j3w1 workstation profile",
  "i3[812]: parsing ~/.config/i3/config",
  "i3[812]: workspace 1:home 2:writing 3:projects 4:photography",
  "i3[812]: workspace 5:books 6:elsewhere 7:about",
  "urxvtd[840]: rendering ~/j3w1",
  "i3[812]: session ready",
];

export const runGreeter = ({ node, onFinish, reducedMotion }) => {
  if (!node) {
    onFinish();
    return { destroy() {} };
  }

  const dots = node.querySelector("[data-dots]");
  const auth = node.querySelector("[data-auth]");
  const log = node.querySelector("[data-log]");
  const hint = node.querySelector("[data-hint]");
  const loginButton = node.querySelector("[data-login]");

  const started = performance.now();
  let raf = 0;
  let finished = false;
  let logged = 0;
  let authenticated = false;

  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener("keydown", onSkip, true);
    window.removeEventListener("pointerdown", onSkip, true);
    window.removeEventListener("touchstart", onSkip, true);
    window.removeEventListener("wheel", onSkip, true);
    loginButton?.removeEventListener("click", onLogin);
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    clearGreetFlag();
    node.classList.add("is-leaving");
    const remove = () => {
      node.hidden = true;
      node.classList.remove("is-leaving");
      onFinish();
    };
    if (reducedMotion) remove();
    else setTimeout(remove, 250);
  };

  const authenticate = () => {
    if (authenticated) return;
    authenticated = true;
    if (dots) dots.textContent = "•".repeat(DOTS);
    if (auth) auth.textContent = "authenticating…";
    if (hint) hint.hidden = true;
  };

  /* Enter or the Log In button authenticates; anything else skips outright. */
  const onLogin = () => {
    authenticate();
    setTimeout(finish, reducedMotion ? 0 : 160);
  };

  const onSkip = (event) => {
    if (event.type === "keydown" && event.key === "Enter") {
      onLogin();
      return;
    }
    if (event.type === "pointerdown" && event.target.closest?.("[data-login]")) return;
    finish();
  };

  const step = () => {
    const elapsed = performance.now() - started;

    if (dots && !authenticated) {
      const filled = Math.min(DOTS, Math.floor(elapsed / DOT_MS));
      const next = "•".repeat(filled);
      if (dots.textContent !== next) dots.textContent = next;
    }
    if (hint && elapsed >= HINT_AT && hint.hidden) hint.hidden = false;
    if (elapsed >= LOG_START - 40 && !authenticated) authenticate();
    if (auth && elapsed >= LOG_START && auth.textContent !== "authentication succeeded") {
      auth.textContent = "authentication succeeded";
    }

    /* Driven by elapsed time, not step count, so a backgrounded tab jumps to the
       end state instead of dragging the animation out behind the visitor. */
    if (log && elapsed >= LOG_START) {
      const wanted = Math.min(LOG.length, Math.floor((elapsed - LOG_START) / LOG_STEP) + 1);
      while (logged < wanted) {
        const item = document.createElement("li");
        const ok = document.createElement("span");
        ok.className = "greeter-ok";
        ok.textContent = "[  OK  ]";
        item.append(ok, document.createTextNode(` ${LOG[logged]}`));
        log.append(item);
        logged += 1;
      }
    }

    if (elapsed >= FADE_AT) node.classList.add("is-leaving");
    if (elapsed >= DONE_AT) {
      finish();
      return;
    }
    raf = requestAnimationFrame(step);
  };

  node.hidden = false;
  window.addEventListener("keydown", onSkip, true);
  window.addEventListener("pointerdown", onSkip, true);
  window.addEventListener("touchstart", onSkip, true);
  window.addEventListener("wheel", onSkip, true);
  loginButton?.addEventListener("click", onLogin);
  raf = requestAnimationFrame(step);

  return { destroy: () => { cleanup(); node.hidden = true; } };
};
