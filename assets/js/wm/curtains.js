/* The session's curtains: LightDM's greeter, i3exit's power sequences, i3lock,
   and the i3-nagbar session menu. They share one screen (#greeter), one rule
   (only one of them up at a time) and one lifecycle, and none of them touches
   the layout tree, so they live apart from boot.js's core and are spread into
   the facade the same way features.js is.

   The greeter, the power sequences and the lock screen are fetched the first
   time they are needed; this module is only the switchboard. */

import { announce } from "./a11y.js?v=20260923";
import { clearGreetFlag, endSession, media, prefs, shouldGreet, startSession } from "./session.js?v=20260923";

/* ctx: { wm(), renderer, dunst, restoreFocus, isBlocked, beforeShutdown } */
export const installCurtains = (ctx) => {
  const { renderer, dunst, restoreFocus, isBlocked, beforeShutdown } = ctx;
  let lock = null;
  let greeterInstance = null;
  let powerInstance = null;
  let greeterLoading = null;

  const showGreeter = (mode) => {
    /* One instance at a time: a second `exec lightdm` while the first is up, or
       while the module is still loading, must not stack a second boot log and a
       second set of key listeners over the first. */
    greeterInstance?.destroy();
    greeterInstance = null;
    if (greeterLoading) return greeterLoading;
    greeterLoading = import("./greeter.js?v=20260923").then(({ runGreeter }) => {
      greeterLoading = null;
      greeterInstance = runGreeter({
        node: document.querySelector("#greeter"),
        mode,
        reducedMotion: media.reducedMotion.matches,
        onLogin: () => {
          greeterInstance = null;
          startSession();
          clearGreetFlag();
          renderer.invalidate();
          renderer.renderNow();
          announce("logged in to the i3 session");
          restoreFocus(null);
        },
      });
    }).catch(() => {
      /* If the greeter cannot load, do not strand the visitor behind it. */
      greeterLoading = null;
      startSession();
      clearGreetFlag();
    });
    return greeterLoading;
  };

  const facade = {
    /* i3 answers $mod+Shift+E with a nagbar rather than exiting outright, so
       the session actions live behind one too. */
    togglePowerMenu(force) {
      const menu = document.querySelector("#power-menu");
      const toggle = document.querySelector("#power-menu-toggle");
      if (!menu) return false;
      const open = force ?? menu.hidden;
      menu.hidden = !open;
      toggle?.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector("[data-power]")?.focus({ preventScroll: true });
      else toggle?.focus({ preventScroll: true });
      return open;
    },

    powerMenuIsOpen: () => document.querySelector("#power-menu")?.hidden === false,

    /* i3exit: every session action, from the system mode, the nagbar, the
       launcher and the shell alike. */
    power(action) {
      if (action === "lock") return Boolean(lock?.lock());
      if (action === "logout" || action === "exit") return facade.logout();
      if (action === "restart") return ctx.wm().restart();
      if (action === "switch_user") return (showGreeter("login"), true);
      if (["reboot", "shutdown", "suspend", "hibernate"].includes(action)) return facade.runPower(action);
      return false;
    },

    /* The power sequences live in power.js and borrow the greeter's screen.
       A reboot or shutdown ends the stored session at the *start*, so a reload
       mid-sequence lands on the boot screen — the right outcome for a machine
       that was going down — and closes every spawned window, as a real reboot
       would; the saved layout survives, like persisted i3 layout files. */
    runPower(action) {
      powerInstance?.destroy();
      greeterInstance?.destroy();
      greeterInstance = null;
      import("./power.js?v=20260923").then(({ runPower }) => {
        powerInstance = runPower({
          node: document.querySelector("#greeter"),
          action,
          reducedMotion: media.reducedMotion.matches,
          hooks: {
            beforeShutdown: () => {
              beforeShutdown();
              endSession();
              dunst.closeAll();
              renderer.renderNow();
            },
            showGreeter: (mode) => {
              powerInstance = null;
              showGreeter(mode);
            },
            lock: () => {
              powerInstance = null;
              lock?.lock();
              announce("screen locked");
            },
          },
        });
      }).catch(() => {
        powerInstance = null;
        dunst.notify(`${action}: power management unavailable`, { key: "power" });
      });
      dunst.notify(`i3exit ${action}`, { key: "power" });
      return true;
    },

    /* Ends the stored session and returns to the greeter's login panel — no
       boot log, exactly as logging out of a running X session behaves. */
    logout() {
      endSession();
      dunst.notify("logging out", { key: "session" });
      announce("logged out; showing the login screen");
      showGreeter("login");
      return true;
    },
  };

  return {
    facade,
    showGreeter,
    lock: () => lock,

    /* After the desktop is up: arm i3lock, then either greet or resume the
       stored session. */
    start() {
      import("./idle-lock.js?v=20260923")
        .then(({ installIdleLock }) => {
          lock = installIdleLock({
            node: document.querySelector("#lockscreen"),
            isBusy: () => isBlocked() || Boolean(greeterInstance) || Boolean(powerInstance),
            onLock: () => dunst.notify("i3lock", { key: "lock" }),
          });
        })
        .catch(() => {});

      if (shouldGreet() && prefs.boot) showGreeter("boot");
      else startSession();
    },

    destroy() {
      lock?.destroy();
      greeterInstance?.destroy();
      powerInstance?.destroy();
    },
  };
};
