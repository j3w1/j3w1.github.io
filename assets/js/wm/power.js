/* i3exit: reboot, shutdown, suspend, hibernate — the power sequences.

   These reuse the greeter's screen (#greeter: the boot-log markup, the
   role="dialog", the curtain z-index) with a data-phase attribute per phase,
   and hand the boot-and-login half to greeter.js. Loaded on demand, like the
   greeter; nothing here runs at boot.

   Timings are a real Manjaro's: systemd stops its units in ~2 s, the screen
   is black for a moment (firmware, no GRUB menu — the machine booted quiet),
   the kernel and systemd come up in ~5 s, LightDM waits. Any key or click
   skips the current phase to its end. Reduced motion keeps every state
   change and skips only the animation: a reboot still ends at the login
   panel, a shutdown still ends at the halted screen.

   Keys are listened for on `window` in the capture phase, ahead of the
   greeter and i3lock (which listen on document), so the key that wakes a
   suspended machine cannot also unlock it. */

import { playLines, RESUME_LOG, SHUTDOWN_LOG, TIMING } from "./console.js?v=20260905j";

const BLACK_MS = 1400;
const HALT_HINT_MS = 3000;
const WAKE_MS = 300;

export const runPower = ({ node, action, reducedMotion, hooks }) => {
  const banner = node.querySelector("[data-banner]");
  const log = node.querySelector("[data-log]");
  const bootScreen = node.querySelector("[data-boot-screen]");
  const loginScreen = node.querySelector("[data-login-screen]");
  const hint = node.querySelector("[data-hint]");
  const powerButton = node.querySelector("[data-power-on]");

  let player = null;
  let timer = 0;
  let done = false;
  let onSkip = null;

  const later = (callback, delay) => {
    clearTimeout(timer);
    if (reducedMotion) {
      callback();
      return;
    }
    timer = setTimeout(callback, delay);
  };

  const phase = (name, label) => {
    node.dataset.phase = name;
    node.setAttribute("aria-label", label);
  };

  const cleanup = () => {
    player?.cancel();
    player = null;
    clearTimeout(timer);
    timer = 0;
    onSkip = null;
    window.removeEventListener("keydown", onKey, true);
    node.removeEventListener("pointerdown", onPointer, true);
    powerButton?.removeEventListener("click", onPowerOn);
    if (powerButton) powerButton.hidden = true;
    if (hint) hint.hidden = true;
  };

  /* The sequence ends by handing the node to the greeter (which resets it) or
     to the lock screen; either way this module stops listening first. */
  const finish = (next) => {
    if (done) return;
    done = true;
    cleanup();
    delete node.dataset.phase;
    node.setAttribute("aria-label", "Manjaro i3 session login");
    next();
  };

  const showScreen = () => {
    node.hidden = false;
    document.documentElement.classList.add("wm-greeting");
    banner?.replaceChildren();
    log?.replaceChildren();
    if (bootScreen) bootScreen.hidden = false;
    if (loginScreen) loginScreen.hidden = true;
    if (hint) hint.hidden = true;
  };

  const black = (label, then) => {
    phase("black", label);
    onSkip = then;
    later(then, BLACK_MS);
  };

  const shutdownLog = (target, then) => {
    phase("shutdown", target === "reboot" ? "System is rebooting" : "System is shutting down");
    onSkip = () => player?.skip();
    player = playLines({
      banner,
      log,
      bannerLines: [],
      lines: SHUTDOWN_LOG(target),
      lineMs: TIMING.shutdownLineMs,
      settleMs: 500,
      instant: reducedMotion,
      onDone: then,
    });
  };

  const boot = () => finish(() => hooks.showGreeter("boot"));

  const halted = () => {
    phase("off", "System halted — press the power button to start the machine");
    if (powerButton) {
      powerButton.hidden = false;
      powerButton.focus({ preventScroll: true });
    }
    onSkip = powerOn;
    later(() => {
      if (hint && !done) {
        hint.textContent = "press any key to power on";
        hint.hidden = false;
      }
    }, HALT_HINT_MS);
  };

  function powerOn() {
    onSkip = null;
    if (powerButton) powerButton.hidden = true;
    if (hint) hint.hidden = true;
    black("Powering on", boot);
  }

  const sleep = (label, wake) => {
    phase("sleep", label);
    /* No timer: a suspended machine waits for someone. */
    onSkip = wake;
  };

  const wakeToLock = () => finish(() => {
    node.hidden = true;
    document.documentElement.classList.remove("wm-greeting");
    hooks.lock();
  });

  function onKey(event) {
    if (done) return;
    event.preventDefault();
    event.stopPropagation();
    onSkip?.();
  }

  function onPointer(event) {
    if (done) return;
    event.preventDefault();
    if (event.target.closest?.("[data-power-on]")) {
      if (node.dataset.phase === "off") powerOn();
      return;
    }
    onSkip?.();
  }

  /* Keyboard activation of the focused power button (Enter/Space arrive as
     keydown first and are handled there; this covers assistive clicks). */
  function onPowerOn(event) {
    event.preventDefault();
    event.stopPropagation();
    if (node.dataset.phase === "off") powerOn();
  }

  window.addEventListener("keydown", onKey, true);
  node.addEventListener("pointerdown", onPointer, true);
  powerButton?.addEventListener("click", onPowerOn);

  showScreen();
  if (action === "reboot") {
    hooks.beforeShutdown();
    shutdownLog("reboot", () => black("Restarting", boot));
  } else if (action === "shutdown") {
    hooks.beforeShutdown();
    shutdownLog("poweroff", halted);
  } else if (action === "suspend") {
    /* i3exit suspend: blurlock && systemctl suspend. */
    hooks.lock();
    sleep("Suspended — press any key to wake", () => {
      onSkip = null;
      later(wakeToLock, WAKE_MS);
    });
  } else if (action === "hibernate") {
    hooks.lock();
    sleep("Hibernated — press any key to resume", () => {
      onSkip = null;
      black("Resuming", () => {
        phase("shutdown", "Resuming from hibernation");
        onSkip = () => player?.skip();
        player = playLines({ log, bannerLines: [], lines: RESUME_LOG, lineMs: 120, settleMs: 300, instant: reducedMotion, onDone: wakeToLock });
      });
    });
  } else {
    finish(() => {
      node.hidden = true;
      document.documentElement.classList.remove("wm-greeting");
    });
  }

  return {
    destroy: () => {
      if (done) return;
      done = true;
      cleanup();
      delete node.dataset.phase;
      node.hidden = true;
      document.documentElement.classList.remove("wm-greeting");
    },
  };
};
