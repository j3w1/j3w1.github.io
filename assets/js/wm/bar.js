/* i3status blocks.

   Every value is read from the visitor's own browser and never transmitted. A
   block whose source does not exist is not rendered at all — no placeholder, no
   "n/a", no invented number. The bar being visibly shorter in Firefox than in
   Chromium is the correct outcome, not a bug to paper over.

   Deliberately not implemented, because no honest browser source exists: volume,
   disk usage, CPU load, temperature, network SSID, and system uptime.
   (navigator.storage.estimate() reports an origin quota, not a disk.) */

import { element } from "./dom.js?v=20260905h";

const FAST_MS = 1000;
const SLOW_MS = 10000;

const formatUptime = (ms) => {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

export const installBar = ({ container, modeNode, clockNode, workspaceLinks }) => {
  const connection = navigator.connection ?? null;
  const battery = { api: null };
  const blocks = new Map();
  let fast = 0;
  let slow = 0;

  const define = (name, label, read) => {
    const value = read();
    if (value === null || value === undefined) return;
    const node = element("span", `i3block i3block-${name}`);
    node.dataset.block = name;
    node.append(element("span", "sr-only", `${label}: `));
    const text = element("span", "i3block-value", String(value));
    node.append(text);
    container.append(node);
    blocks.set(name, { node, text, read, label });
  };

  const refresh = (names) => {
    for (const [name, block] of blocks) {
      if (names && !names.includes(name)) continue;
      const value = block.read();
      if (value === null || value === undefined) {
        block.node.hidden = true;
        continue;
      }
      block.node.hidden = false;
      const next = String(value);
      if (block.text.textContent !== next) block.text.textContent = next;
    }
  };

  const build = () => {
    container.replaceChildren();
    blocks.clear();

    define("net", "Network", () => {
      if (!connection?.effectiveType) return null;
      const downlink = Number.isFinite(connection.downlink) ? ` ${connection.downlink}Mb` : "";
      return `net ${connection.effectiveType}${downlink}`;
    });

    define("cpu", "CPU threads", () =>
      Number.isFinite(navigator.hardwareConcurrency) ? `cpu ${navigator.hardwareConcurrency} thr` : null);

    define("mem", "Device memory", () =>
      Number.isFinite(navigator.deviceMemory) ? `mem ${navigator.deviceMemory} GiB` : null);

    define("heap", "JavaScript heap", () => {
      const used = performance.memory?.usedJSHeapSize;
      return Number.isFinite(used) ? `heap ${Math.round(used / 1048576)} MiB` : null;
    });

    define("bat", "Battery", () => {
      const api = battery.api;
      if (!api) return null;
      /* A desktop reports a full, charging battery, which is indistinguishable
         from having none — and showing "100% BAT" on a tower reads as fabricated. */
      if (api.level === 1 && api.charging) return null;
      return `bat ${Math.round(api.level * 100)}%${api.charging ? " chr" : ""}`;
    });

    define("res", "Viewport", () => {
      const ratio = window.devicePixelRatio !== 1 ? `@${window.devicePixelRatio.toFixed(1)}x` : "";
      return `${window.innerWidth}x${window.innerHeight}${ratio}`;
    });

    define("lang", "Language", () => navigator.language || null);

    define("tz", "Time zone", () => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      } catch {
        return null;
      }
    });

    define("up", "Session uptime", () => `up ${formatUptime(performance.now())}`);
  };

  const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const tickClock = () => {
    if (!clockNode) return;
    const now = new Date();
    clockNode.dateTime = now.toISOString();
    clockNode.textContent = clockFormat.format(now);
  };

  /* Timers stop entirely while the tab is hidden. The static site ticked a one
     second interval forever in background tabs; this fixes that too. */
  const start = () => {
    stop();
    tickClock();
    refresh();
    fast = setInterval(tickClock, FAST_MS);
    slow = setInterval(() => refresh(["heap", "up"]), SLOW_MS);
  };

  const stop = () => {
    if (fast) clearInterval(fast);
    if (slow) clearInterval(slow);
    fast = 0;
    slow = 0;
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") start();
    else stop();
  };

  const onResize = () => refresh(["res"]);
  const onConnection = () => refresh(["net"]);
  const onLanguage = () => refresh(["lang"]);

  build();
  start();

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onResize, { passive: true });
  connection?.addEventListener?.("change", onConnection);
  window.addEventListener("languagechange", onLanguage);

  navigator.getBattery?.().then((api) => {
    battery.api = api;
    refresh(["bat"]);
    api.addEventListener?.("levelchange", () => refresh(["bat"]));
    api.addEventListener?.("chargingchange", () => refresh(["bat"]));
  }).catch(() => {
    /* Removed in Firefox, never shipped in Safari: the block stays absent. */
  });

  return {
    setMode(mode, prompt = mode) {
      if (!modeNode) return;
      const isDefault = mode === "default";
      modeNode.hidden = isDefault;
      modeNode.textContent = isDefault ? "" : prompt;
      document.documentElement.classList.toggle("wm-mode-active", !isDefault);
    },
    setUrgent(name, urgent) {
      const link = workspaceLinks.find((node) => node.dataset.workspaceLink === name);
      if (!link) return;
      link.classList.toggle("is-urgent", urgent);
      const label = link.textContent.trim();
      if (urgent) link.setAttribute("aria-label", `${label} (urgent)`);
      else link.removeAttribute("aria-label");
    },
    setWindowCount(name, count) {
      const link = workspaceLinks.find((node) => node.dataset.workspaceLink === name);
      if (link) link.dataset.wmCount = String(count);
    },
    refresh,
    destroy() {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      connection?.removeEventListener?.("change", onConnection);
      window.removeEventListener("languagechange", onLanguage);
    },
  };
};
