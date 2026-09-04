/* The boot sequence and the LightDM greeter.

   Two phases. The boot log scrolls (skippable with any key), then the login
   panel appears and *waits* — it never logs itself in. Logging in stores a
   session, so a returning visitor goes straight to the desktop until they log
   out again; logging out returns to the greeter without replaying the boot.

   The panel is interactive by design, so unlike the lock screen it is neither
   inert nor aria-hidden: it is a labelled dialog with a real focusable button.
   It still never touches <main>, never traps focus, and never runs when the
   visitor arrived at a deep link, when a session already exists, or under
   automation — see the inline decision script in index.html. */

const BOOT_BANNER = [
  "Manjaro Linux 24.2 Yonada (tty1)",
  "Linux 6.12.4-1-MANJARO x86_64",
];

/* kind: "kernel" | "ok" | "start" | "plain" */
const BOOT_LOG = [
  ["kernel", "[    0.000000] Linux version 6.12.4-1-MANJARO (gcc 14.2.1, GNU ld 2.43)"],
  ["kernel", "[    0.000000] Command line: BOOT_IMAGE=/boot/vmlinuz-6.12-x86_64 rw quiet splash"],
  ["kernel", "[    0.184213] Memory: 16334M available"],
  ["kernel", "[    0.291884] Run /init as init process"],
  ["kernel", "[    0.412518] systemd[1]: systemd 257 running in system mode (+PAM +AUDIT +SELINUX)"],
  ["kernel", "[    0.418902] systemd[1]: Detected architecture x86-64."],
  ["ok", "Created slice Slice /system/getty."],
  ["ok", "Reached target Swaps."],
  ["ok", "Listening on Journal Socket."],
  ["start", "Starting Journal Service..."],
  ["ok", "Started Journal Service."],
  ["ok", "Finished Load Kernel Modules."],
  ["ok", "Mounted /boot/efi."],
  ["ok", "Reached target Local File Systems."],
  ["start", "Starting Rule-based Manager for Device Events..."],
  ["ok", "Started Rule-based Manager for Device Events and Files."],
  ["ok", "Found device /dev/disk/by-uuid/8f3a1c2e-4d7b."],
  ["ok", "Reached target System Initialization."],
  ["ok", "Started Daily man-db regeneration."],
  ["ok", "Reached target Timer Units."],
  ["ok", "Listening on D-Bus System Message Bus Socket."],
  ["ok", "Started D-Bus System Message Bus."],
  ["start", "Starting Network Manager..."],
  ["ok", "Started Network Manager."],
  ["ok", "Reached target Network."],
  ["ok", "Started OpenSSH Daemon."],
  ["ok", "Started Avahi mDNS/DNS-SD Stack."],
  ["ok", "Started TLP system startup/shutdown."],
  ["start", "Starting Light Display Manager..."],
  ["ok", "Started Light Display Manager."],
  ["ok", "Reached target Graphical Interface."],
  ["start", "Starting Update UTMP about System Runlevel Changes..."],
  ["ok", "Finished Update UTMP about System Runlevel Changes."],
  ["plain", "lightdm[812]: Starting seat seat0"],
  ["plain", "lightdm[812]: Starting greeter session"],
];

const BANNER_MS = 320;
const LINE_MS = 108;
const HINT_AT = 900;
const SETTLE_MS = 420;
const DOTS = 11;
const DOT_MS = 42;

export const runGreeter = ({ node, mode = "boot", reducedMotion, onLogin }) => {
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

  let raf = 0;
  let dotTimer = 0;
  let printed = 0;
  let bannerShown = 0;
  let finished = false;
  let phase = mode === "login" ? "login" : "boot";

  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    if (dotTimer) clearInterval(dotTimer);
    raf = 0;
    dotTimer = 0;
    window.removeEventListener("keydown", onKeydown, true);
    node.removeEventListener("pointerdown", onPointerDown);
    loginButton?.removeEventListener("click", authenticate);
  };

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
    else setTimeout(hide, 240);
  };

  const authenticate = () => {
    if (phase !== "login" || finished) return;
    phase = "authenticating";
    if (auth) auth.textContent = "authenticating…";
    if (hint) hint.hidden = true;
    setTimeout(() => {
      if (auth) auth.textContent = "authentication succeeded";
      setTimeout(finish, reducedMotion ? 0 : 260);
    }, reducedMotion ? 0 : 340);
  };

  /* The password field is decoration: a fixed run of bullets, filled by a timer.
     There is no password value anywhere in the source, and nothing is checked. */
  const showLogin = () => {
    phase = "login";
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

  const appendLine = ([kind, text]) => {
    const item = document.createElement("li");
    item.className = `greeter-line greeter-line-${kind}`;
    if (kind === "ok") {
      const tag = document.createElement("span");
      tag.className = "greeter-ok";
      tag.textContent = "[  OK  ]";
      item.append(tag, document.createTextNode(` ${text}`));
    } else if (kind === "start") {
      const tag = document.createElement("span");
      tag.className = "greeter-pending";
      tag.textContent = "[      ]";
      item.append(tag, document.createTextNode(` ${text}`));
    } else {
      item.textContent = text;
    }
    log?.append(item);
    if (log) log.scrollTop = log.scrollHeight;
  };

  const started = performance.now();

  /* Driven by elapsed time rather than step count, so a backgrounded tab catches
     up instantly instead of dragging the sequence out behind the visitor. */
  const step = () => {
    const elapsed = performance.now() - started;

    const wantBanner = Math.min(BOOT_BANNER.length, Math.floor(elapsed / BANNER_MS) + 1);
    while (bannerShown < wantBanner) {
      const line = document.createElement("span");
      line.textContent = BOOT_BANNER[bannerShown];
      banner?.append(line);
      bannerShown += 1;
    }

    if (elapsed >= HINT_AT && hint?.hidden) hint.hidden = false;

    const logElapsed = elapsed - BOOT_BANNER.length * BANNER_MS;
    if (logElapsed >= 0) {
      const want = Math.min(BOOT_LOG.length, Math.floor(logElapsed / LINE_MS) + 1);
      while (printed < want) {
        appendLine(BOOT_LOG[printed]);
        printed += 1;
      }
    }

    if (printed >= BOOT_LOG.length && logElapsed >= BOOT_LOG.length * LINE_MS + SETTLE_MS) {
      raf = 0;
      showLogin();
      return;
    }
    raf = requestAnimationFrame(step);
  };

  const skipBoot = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    while (bannerShown < BOOT_BANNER.length) {
      const line = document.createElement("span");
      line.textContent = BOOT_BANNER[bannerShown];
      banner?.append(line);
      bannerShown += 1;
    }
    while (printed < BOOT_LOG.length) {
      appendLine(BOOT_LOG[printed]);
      printed += 1;
    }
    showLogin();
  };

  function onKeydown(event) {
    if (finished) return;
    if (phase === "boot") {
      event.preventDefault();
      skipBoot();
      return;
    }
    if (phase === "login" && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      authenticate();
    }
  }

  function onPointerDown(event) {
    if (finished) return;
    if (phase === "boot") {
      skipBoot();
      return;
    }
    if (phase === "login" && !event.target.closest("[data-login]")) authenticate();
  }

  node.hidden = false;
  document.documentElement.classList.add("wm-greeting");
  window.addEventListener("keydown", onKeydown, true);
  node.addEventListener("pointerdown", onPointerDown);
  loginButton?.addEventListener("click", authenticate);

  if (phase === "login") {
    if (bootScreen) bootScreen.hidden = true;
    showLogin();
  } else if (reducedMotion) {
    skipBoot();
  } else {
    raf = requestAnimationFrame(step);
  }

  return {
    destroy: () => {
      cleanup();
      node.hidden = true;
      document.documentElement.classList.remove("wm-greeting");
    },
  };
};
