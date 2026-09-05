/* i3status blocks.

   Every value is read from the visitor's own browser and never transmitted. A
   block whose source does not exist is not rendered at all — no placeholder, no
   "n/a", no invented number. The bar being visibly shorter in Firefox than in
   Chromium is the correct outcome, not a bug to paper over.

   Deliberately not implemented, because no honest browser source exists: volume,
   disk usage, CPU load, temperature, network SSID, and system uptime.
   (navigator.storage.estimate() reports an origin quota, not a disk.) */

import { element } from "./dom.js?v=20260905i";

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

/* The original i3status.conf, block by block. Labels are Chinese with Nerd
   glyphs, exactly as the config wrote them; `bar labels en` switches the
   visible text while the screen-reader label stays English either way.
   Only blocks with an honest browser source exist — cpu_usage, load and the
   disks are absent because nothing in a browser reports them. */
const GLYPH = Object.freeze({
  cpu: "",
  mem: "",
  heap: "",
  bat: "",
  charging: "",
  net: "",
  res: "",
  lang: "",
  tz: "",
  up: "",
});

const LABELS = Object.freeze({
  zh: { cpu: "处理器", mem: "内存储器", heap: "堆", bat: "电池", net: "局域网：", res: "分辨率", lang: "语言", tz: "时区", up: "运行" },
  en: { cpu: "cpu", mem: "mem", heap: "heap", bat: "bat", net: "net ", res: "", lang: "", tz: "", up: "up" },
});

export const installBar = ({ container, modeNode, clockNode, workspaceLinks, labels = "zh" }) => {
  const connection = navigator.connection ?? null;
  const battery = { api: null };
  const blocks = new Map();
  let language = LABELS[labels] ? labels : "zh";
  let fast = 0;
  let slow = 0;

  const define = (name, label, read) => {
    const value = read();
    if (value === null || value === undefined) return;
    const node = element("span", `i3block i3block-${name}`);
    node.dataset.block = name;
    node.append(element("span", "sr-only", `${label}: `));
    const glyph = element("span", "i3block-glyph", GLYPH[name] ?? "");
    glyph.setAttribute("aria-hidden", "true");
    const text = element("span", "i3block-value");
    node.append(glyph, text);
    container.append(node);
    blocks.set(name, { node, text, glyph, read, label });
    paintBlock(blocks.get(name), value);
  };

  /* value: a string, or { glyph, text } when the glyph depends on the reading. */
  const paintBlock = (block, value) => {
    const reading = typeof value === "string" ? { text: value } : value;
    const prefix = LABELS[language][block.node.dataset.block] ?? "";
    const next = `${prefix}${prefix && !prefix.endsWith("：") && !prefix.endsWith(" ") ? " " : ""}${reading.text}`;
    if (block.text.textContent !== next) block.text.textContent = next;
    if (language === "zh" && prefix) block.text.setAttribute("lang", "zh");
    else block.text.removeAttribute("lang");
    const glyph = reading.glyph ?? GLYPH[block.node.dataset.block] ?? "";
    if (block.glyph.textContent !== glyph) block.glyph.textContent = glyph;
    block.node.classList.toggle("is-degraded", Boolean(reading.degraded));
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
      paintBlock(block, value);
    }
  };

  const build = () => {
    container.replaceChildren();
    blocks.clear();

    define("net", "Network", () => {
      if (!connection?.effectiveType) return null;
      const downlink = Number.isFinite(connection.downlink) ? ` ${connection.downlink}Mb` : "";
      return `${connection.effectiveType}${downlink}`;
    });

    define("cpu", "CPU threads", () =>
      Number.isFinite(navigator.hardwareConcurrency) ? `${navigator.hardwareConcurrency} thr` : null);

    define("mem", "Device memory", () =>
      Number.isFinite(navigator.deviceMemory) ? `${navigator.deviceMemory} GiB` : null);

    define("heap", "JavaScript heap", () => {
      const used = performance.memory?.usedJSHeapSize;
      return Number.isFinite(used) ? `${Math.round(used / 1048576)} MiB` : null;
    });

    define("bat", "Battery", () => {
      const api = battery.api;
      if (!api) return null;
      /* A desktop reports a full, charging battery, which is indistinguishable
         from having none — and showing "100% BAT" on a tower reads as fabricated. */
      if (api.level === 1 && api.charging) return null;
      const level = Math.round(api.level * 100);
      /* low_threshold 30 in the config: the reading turns "degraded". */
      return { text: `${level}%${api.charging ? " chr" : ""}`, glyph: api.charging ? GLYPH.charging : GLYPH.bat, degraded: !api.charging && level <= 30 };
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

    define("up", "Session uptime", () => formatUptime(performance.now()));
  };

  const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const two = (value) => String(value).padStart(2, "0");
  /* tztime from the config: "%m月%d号 %H时%M分%S秒". */
  const zhClock = (now) => `${two(now.getMonth() + 1)}月${two(now.getDate())}号 ${two(now.getHours())}时${two(now.getMinutes())}分${two(now.getSeconds())}秒`;
  const tickClock = () => {
    if (!clockNode) return;
    const now = new Date();
    clockNode.dateTime = now.toISOString();
    clockNode.textContent = language === "zh" ? zhClock(now) : clockFormat.format(now);
    if (language === "zh") clockNode.setAttribute("lang", "zh");
    else clockNode.removeAttribute("lang");
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
    /* bar labels zh | en */
    setLabels(next) {
      if (!LABELS[next]) return false;
      language = next;
      refresh();
      tickClock();
      return true;
    },
    labels: () => language,
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
