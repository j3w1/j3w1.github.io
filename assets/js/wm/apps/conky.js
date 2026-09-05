/* conky, after the original conky.conf: a transparent panel at the top right
   with the date in Chinese (Source Han Sans in the config; the CJK face here),
   the day and year large, then CPU, RAM, the system line and uptime.

   Every figure has a real browser source or is absent. The original showed
   CPU load and the top processes by usage; a browser exposes neither, so the
   "processes" are the open windows and there are no percentages, and RAM is
   the device memory bucket plus the JavaScript heap where the browser reports
   one. Nothing is invented — see wm-architecture.md §10. */

import { element } from "../dom.js?v=20260905k";

const value = (candidate, suffix = "") =>
  candidate === null || candidate === undefined || candidate === "" ? null : `${candidate}${suffix}`;

const formatUptime = (ms) => {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${total % 60}s`;
};

export const createConky = ({ body, wm }) => {
  const view = element("div", "conky");
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" });
  const month = new Intl.DateTimeFormat("zh-CN", { month: "long" });

  const line = (className, text) => {
    const node = element("p", className, text ?? "");
    if (className.includes("zh")) node.setAttribute("lang", "zh");
    return node;
  };
  const row = (label, reading, strong = false) => {
    if (reading === null) return null;
    const node = element("p", "conky-row");
    node.append(element("span", strong ? "conky-label conky-strong" : "conky-label", label), element("span", "conky-value", reading));
    return node;
  };

  const dateBlock = element("div", "conky-date");
  const weekdayNode = line("conky-weekday conky-zh");
  const dayNode = line("conky-day");
  const monthNode = line("conky-month conky-zh");
  const yearNode = line("conky-year");
  dateBlock.append(weekdayNode, dayNode, monthNode, yearNode);

  const sections = element("div", "conky-sections");
  const foot = element("div", "conky-foot");

  const render = () => {
    const now = new Date();
    weekdayNode.textContent = weekday.format(now);
    dayNode.textContent = String(now.getDate());
    monthNode.textContent = month.format(now);
    yearNode.textContent = String(now.getFullYear());

    sections.replaceChildren();
    const threads = value(Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null, " threads");
    const cpu = row("CPU", threads, true);
    if (cpu) sections.append(cpu);
    const processes = wm.processList().filter((process) => !process.hidden).slice(0, 4);
    processes.forEach((process) => sections.append(row(process.title, process.focused ? "focused" : "running")));

    const memory = value(Number.isFinite(navigator.deviceMemory) ? navigator.deviceMemory : null, " GiB");
    const heap = performance.memory?.usedJSHeapSize;
    const ram = row("RAM", memory, true);
    if (ram) sections.append(ram);
    if (Number.isFinite(heap)) sections.append(row("JS heap", `${Math.round(heap / 1048576)} MiB`));

    foot.replaceChildren(
      line("conky-foot-line", "Manjaro Linux"),
      line("conky-foot-line conky-strong", "j3w1@manjaro"),
      row("uptime", formatUptime(performance.now())),
      row("kernel", "j3w1.github.io"),
    );
  };

  view.append(dateBlock, sections, foot);
  body.append(view);
  render();

  /* The original updated every second; here every ten, and never while the
     window or the tab is hidden. */
  const shown = () => document.visibilityState === "visible" && !view.closest("[data-wm-window]")?.hidden;
  const timer = setInterval(() => {
    if (shown()) render();
  }, 10000);

  return {
    destroy: () => {
      clearInterval(timer);
      view.remove();
    },
  };
};
