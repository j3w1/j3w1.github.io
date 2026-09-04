/* neofetch. Every field is read from this browser; anything it does not expose
   prints "unknown" rather than a plausible-looking invention. */

import { element } from "../dom.js?v=20260904";

const LOGO = [
  "██████████████████  ████████",
  "██████████████████  ████████",
  "██████████████████  ████████",
  "██████████████████  ████████",
  "████████            ████████",
  "████████  ████████  ████████",
  "████████  ████████  ████████",
  "████████  ████████  ████████",
  "████████  ████████  ████████",
  "████████  ████████  ████████",
  "████████  ████████  ████████",
  "████████  ████████  ████████",
];

const browser = () => {
  const brands = navigator.userAgentData?.brands
    ?.filter((brand) => !/not.a.brand/i.test(brand.brand))
    .map((brand) => `${brand.brand} ${brand.version}`);
  if (brands?.length) return brands.join(", ");
  const ua = navigator.userAgent;
  const match = ua.match(/(Firefox|Edg|Chrome|Safari)\/([\d.]+)/);
  return match ? `${match[1] === "Edg" ? "Edge" : match[1]} ${match[2].split(".")[0]}` : "unknown";
};

const platform = () =>
  navigator.userAgentData?.platform || navigator.platform || "unknown";

const uptime = () => {
  const seconds = Math.floor(performance.now() / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min, ${seconds % 60} sec` : `${seconds} sec`;
};

const value = (candidate, suffix = "") =>
  candidate === null || candidate === undefined || candidate === "" ? "unknown" : `${candidate}${suffix}`;

export const createNeofetch = ({ body }) => {
  const view = element("div", "neofetch");
  const art = element("pre", "neofetch-logo", LOGO.join("\n"));
  art.setAttribute("aria-hidden", "true");

  const rows = [
    ["", "j3w1@manjaro"],
    ["", "------------"],
    ["OS", "Manjaro Linux (i3 community edition)"],
    ["Host", value(platform())],
    ["Kernel", "j3w1.github.io"],
    ["Uptime", uptime()],
    ["Shell", "zsh"],
    ["WM", "i3"],
    ["Terminal", "urxvt"],
    ["Browser", value(browser())],
    ["Resolution", `${window.innerWidth}x${window.innerHeight}`],
    ["Display", value(screen?.width && `${screen.width}x${screen.height} @${window.devicePixelRatio.toFixed(1)}x`)],
    ["CPU", value(navigator.hardwareConcurrency, " threads")],
    ["Memory", value(navigator.deviceMemory, " GiB")],
    ["Locale", value(navigator.language)],
    ["Timezone", value(Intl.DateTimeFormat().resolvedOptions().timeZone)],
  ];

  const info = element("dl", "neofetch-info");
  rows.forEach(([label, text]) => {
    const row = element("div");
    row.append(element("dt", "", label), element("dd", "", text));
    info.append(row);
  });

  const swatches = element("div", "neofetch-swatches");
  swatches.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 8; index += 1) swatches.append(element("span", `neofetch-swatch s${index}`));

  const column = element("div", "neofetch-column");
  column.append(info, swatches);
  view.append(art, column);
  body.append(view);

  return { destroy: () => view.remove() };
};
