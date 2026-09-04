/* htop, where the processes are the windows actually open on this desktop.

   The meters show measurements the browser really provides — frame interval and
   JavaScript heap — and say so when it does not. There is no synthesised CPU
   percentage, because a fabricated number sitting three inches above a portfolio
   costs more credibility than the widget is worth. */

import { element } from "../dom.js?v=20260904";

const bar = (ratio, width = 20) => {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `[${"|".repeat(filled)}${" ".repeat(width - filled)}]`;
};

export const createHtop = ({ body, wm }) => {
  const view = element("div", "htop");
  const meters = element("pre", "htop-meters");
  const table = element("table", "htop-table");
  const head = element("thead");
  const headRow = element("tr");
  ["PID", "USER", "S", "MEM", "TIME+", "COMMAND"].forEach((label) => {
    headRow.append(element("th", "", label));
  });
  head.append(headRow);
  const tbody = element("tbody");
  table.append(head, tbody);
  view.append(meters, table);
  body.append(view);

  let frames = 0;
  let lastSample = performance.now();
  let interval = 16.7;
  let raf = 0;

  const sample = () => {
    frames += 1;
    const now = performance.now();
    if (now - lastSample >= 500) {
      interval = (now - lastSample) / frames;
      frames = 0;
      lastSample = now;
    }
    raf = requestAnimationFrame(sample);
  };

  const renderMeters = () => {
    const heap = performance.memory?.usedJSHeapSize;
    const limit = performance.memory?.jsHeapSizeLimit;
    const fps = Math.min(60, Math.round(1000 / interval));
    const lines = [
      `  Frame  ${bar(fps / 60)} ${fps} fps (${interval.toFixed(1)} ms)`,
      heap && limit
        ? `  Heap   ${bar(heap / limit)} ${Math.round(heap / 1048576)}M / ${Math.round(limit / 1048576)}M`
        : "  Heap   not reported by this browser",
      `  Tasks: ${wm.windowCount()} windows, ${wm.workspaceCount()} workspaces`,
      `  Uptime: ${Math.floor(performance.now() / 1000)}s`,
    ];
    meters.textContent = lines.join("\n");
  };

  const renderRows = () => {
    const processes = wm.processList();
    tbody.replaceChildren();
    processes.forEach((process, index) => {
      const row = element("tr");
      if (process.focused) row.className = "is-selected";
      [
        String(1000 + index),
        "j3w1",
        process.hidden ? "S" : "R",
        process.hidden ? "0.0" : "0.1",
        `${Math.floor(performance.now() / 1000)}s`,
        process.title,
      ].forEach((cell) => row.append(element("td", "", cell)));
      tbody.append(row);
    });
  };

  const tick = () => {
    renderMeters();
    renderRows();
  };

  tick();
  raf = requestAnimationFrame(sample);
  const timer = setInterval(tick, 1000);
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      if (!raf) raf = requestAnimationFrame(sample);
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    destroy: () => {
      clearInterval(timer);
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      view.remove();
    },
  };
};
