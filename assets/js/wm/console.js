/* The system console: the boot log, the shutdown log, and the player that
   scrolls them. Used by the greeter (boot), the power sequences (shutdown,
   reboot, resume) and the terminal's `journalctl -b`.

   The player is driven by elapsed time rather than step count, so a
   backgrounded tab catches up instantly instead of dragging the sequence out
   behind the visitor; any key or click can skip to the end. Reduced motion is
   the caller's decision — pass `instant` and every line lands at once. */

export const BOOT_BANNER = [
  "Manjaro Linux 24.2 Yonada (tty1)",
  "Linux 6.12.4-1-MANJARO x86_64",
];

/* kind: "kernel" | "ok" | "start" | "plain" */
export const BOOT_LOG = [
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
  ["ok", "Started Bluetooth service."],
  ["ok", "Reached target Bluetooth Support."],
  ["ok", "Started Daemon for power management."],
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

/* systemd going down, in the order it really does: the session and the
   graphical target first, services, then the file systems. */
export const SHUTDOWN_LOG = (target) => [
  ["plain", `systemd[1]: Received SIGRTMIN+${target === "reboot" ? "5" : "4"} from PID 1 (systemctl).`],
  ["start", "Stopping Session 2 of User j3w1..."],
  ["ok", "Stopped target Graphical Interface."],
  ["ok", "Stopped target Multi-User System."],
  ["ok", "Stopped target Login Prompts."],
  ["ok", "Stopped Light Display Manager."],
  ["ok", "Stopped Session 2 of User j3w1."],
  ["ok", "Removed slice Slice /system/getty."],
  ["ok", "Stopped Avahi mDNS/DNS-SD Stack."],
  ["ok", "Stopped OpenSSH Daemon."],
  ["ok", "Stopped Daemon for power management."],
  ["ok", "Stopped Bluetooth service."],
  ["start", "Stopping Network Manager..."],
  ["ok", "Stopped Network Manager."],
  ["ok", "Stopped TLP system startup/shutdown."],
  ["ok", "Stopped D-Bus System Message Bus."],
  ["ok", "Stopped target Basic System."],
  ["ok", "Stopped Journal Service."],
  ["ok", "Unmounted /boot/efi."],
  ["ok", "Reached target Unmount All Filesystems."],
  ["ok", `Reached target System ${target === "reboot" ? "Reboot" : "Power Off"}.`],
  ["plain", target === "reboot" ? "reboot: Restarting system." : "systemd-shutdown: Powering off."],
];

export const RESUME_LOG = [
  ["kernel", "[ 3106.204811] PM: hibernation: hibernation entry"],
  ["kernel", "[ 3106.208442] PM: hibernation: resume from /dev/disk/by-uuid/8f3a1c2e-4d7b"],
  ["kernel", "[ 3107.912340] PM: Image loading progress: 100%"],
  ["kernel", "[ 3108.114209] PM: hibernation: hibernation exit"],
  ["kernel", "[ 3108.117553] Restarting tasks ... done."],
];

export const TIMING = Object.freeze({ bannerMs: 320, lineMs: 108, settleMs: 420, shutdownLineMs: 90 });

export const renderLine = ([kind, text]) => {
  const item = document.createElement("li");
  item.className = `greeter-line greeter-line-${kind}`;
  if (kind === "ok" || kind === "start") {
    const tag = document.createElement("span");
    tag.className = kind === "ok" ? "greeter-ok" : "greeter-pending";
    tag.textContent = kind === "ok" ? "[  OK  ]" : "[      ]";
    item.append(tag, document.createTextNode(` ${text}`));
  } else {
    item.textContent = text;
  }
  return item;
};

/* Plays `bannerLines` into `banner` and `lines` into `log`, then waits
   `settleMs` and calls onDone. Returns { skip, cancel }. */
export const playLines = ({
  banner = null,
  log,
  bannerLines = [],
  lines,
  bannerMs = TIMING.bannerMs,
  lineMs = TIMING.lineMs,
  settleMs = TIMING.settleMs,
  instant = false,
  onProgress,
  onDone,
}) => {
  let raf = 0;
  let timer = 0;
  let bannerShown = 0;
  let printed = 0;
  let done = false;

  const showBanner = (count) => {
    while (bannerShown < count) {
      const line = document.createElement("span");
      line.textContent = bannerLines[bannerShown];
      banner?.append(line);
      bannerShown += 1;
    }
  };
  const print = (count) => {
    while (printed < count) {
      log?.append(renderLine(lines[printed]));
      printed += 1;
    }
    if (log && printed) log.scrollTop = log.scrollHeight;
  };
  const finish = () => {
    if (done) return;
    done = true;
    onDone?.();
  };

  const started = performance.now();
  const step = () => {
    const elapsed = performance.now() - started;
    showBanner(Math.min(bannerLines.length, Math.floor(elapsed / bannerMs) + 1));
    onProgress?.(elapsed);
    const logElapsed = elapsed - bannerLines.length * bannerMs;
    if (logElapsed >= 0) print(Math.min(lines.length, Math.floor(logElapsed / lineMs) + 1));
    if (printed >= lines.length && logElapsed >= lines.length * lineMs + settleMs) {
      raf = 0;
      finish();
      return;
    }
    raf = requestAnimationFrame(step);
  };

  const skip = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    showBanner(bannerLines.length);
    print(lines.length);
    finish();
  };

  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = 0;
    timer = 0;
    done = true;
  };

  if (instant) skip();
  else raf = requestAnimationFrame(step);

  return { skip, cancel };
};
