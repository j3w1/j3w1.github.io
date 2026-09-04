/* Registry of launchable applications. Everything here is a spawned window:
   window-manager owned, holding no authored site content, and therefore safe to
   create and destroy at will. */

import { createShell } from "./shell.js?v=20260904";
import { createNeofetch } from "./neofetch.js?v=20260904";
import { createHtop } from "./htop.js?v=20260904";
import { createMatrix } from "./cmatrix.js?v=20260904";
import { createFeh } from "./feh.js?v=20260904";

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
    create: (context) => createNeofetch(context),
  },
  htop: {
    label: "htop",
    title: "htop — j3w1@manjaro",
    className: "htop-window",
    status: ["htop", "browser metrics"],
    create: (context) => createHtop(context),
  },
  cmatrix: {
    label: "cmatrix",
    title: "cmatrix",
    className: "cmatrix-window",
    status: ["cmatrix"],
    create: (context) => createMatrix(context),
  },
  feh: {
    label: "feh",
    title: "feh — wallpaper",
    className: "feh-window",
    status: ["feh", "CSS wallpapers"],
    create: (context) => createFeh(context),
  },
});

export const APP_NAMES = Object.freeze(Object.keys(APPS));
