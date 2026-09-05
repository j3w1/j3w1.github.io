/* Registry of launchable applications. Everything here is a spawned window:
   window-manager owned, holding no authored site content, and therefore safe to
   create and destroy at will. */

import { createShell } from "./shell.js?v=20260905h";

/* Only the shell is in the boot graph: it drives the home terminal at first
   paint. Everything else is fetched the first time it is launched, so a visitor
   who never runs htop never downloads it. */
const lazy = (load, pick) => async (context) => pick(await load())(context);

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/* A spawned window's chrome: title bar, body, status line. The title bar's
   marks are upgraded to real buttons by the caller, like authored windows. */
export const buildAppWindow = (id, spec) => {
  const article = element("article", `window pane wm-spawned ${spec.className}`);
  article.dataset.wmWindow = id;
  article.dataset.wmTitle = spec.title;
  article.tabIndex = 0;
  article.setAttribute("aria-label", spec.title);
  const header = element("header", "window-titlebar");
  const title = element("span", "", spec.title);
  header.append(title, element("span", "window-marks"));
  const body = spec.body ? spec.body() : element("div", "wm-app-body");
  const status = element("footer", "app-statusline");
  (spec.status ?? []).forEach((label) => status.append(element("span", "", label)));
  status.append(element("span", "status-fill", ""));
  article.append(header, body, status);
  return { article, title, body, status };
};

export const APPS = Object.freeze({
  urxvt: {
    label: "terminal",
    title: "j3w1@manjaro: ~",
    className: "terminal-window",
    status: ["URxvt", "zsh", "utf-8"],
    body: () => {
      const buffer = document.createElement("div");
      buffer.className = "terminal-buffer";
      buffer.setAttribute("role", "document");
      return buffer;
    },
    create: (context) => createShell(context),
  },
  neofetch: {
    label: "neofetch",
    title: "neofetch — j3w1@manjaro",
    className: "neofetch-window",
    status: ["neofetch", "local only"],
    create: lazy(() => import("./neofetch.js?v=20260905h"), (m) => m.createNeofetch),
  },
  htop: {
    label: "htop",
    title: "htop — j3w1@manjaro",
    className: "htop-window",
    status: ["htop", "browser metrics"],
    create: lazy(() => import("./htop.js?v=20260905h"), (m) => m.createHtop),
  },
  cmatrix: {
    label: "cmatrix",
    title: "cmatrix",
    className: "cmatrix-window",
    status: ["cmatrix"],
    create: lazy(() => import("./cmatrix.js?v=20260905h"), (m) => m.createMatrix),
  },
  feh: {
    label: "feh",
    title: "feh — wallpaper",
    className: "feh-window",
    status: ["feh", "CSS wallpapers"],
    create: lazy(() => import("./feh.js?v=20260905h"), (m) => m.createFeh),
  },
});

export const APP_NAMES = Object.freeze(Object.keys(APPS));
