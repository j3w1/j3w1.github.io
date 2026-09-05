/* feh, as a wallpaper picker. The wallpapers are drawn in CSS, so switching one
   costs no request and adds no image bytes to the site. */

import { element } from "../dom.js?v=20260905e";
import { WALLPAPERS } from "../defaults.js?v=20260905e";

const LABELS = Object.freeze({
  black: "black — the default, plain",
  ember: "ember — red wash",
  ridge: "ridge — banded gradient",
});

export const createFeh = ({ body, wm }) => {
  const view = element("div", "feh");
  const list = element("div", "feh-grid");
  list.setAttribute("role", "radiogroup");
  list.setAttribute("aria-label", "Wallpaper");

  const buttons = WALLPAPERS.map((name) => {
    const button = element("button", "feh-thumb");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.dataset.wallpaper = name;
    const preview = element("span", `feh-preview wallpaper-${name}`);
    preview.setAttribute("aria-hidden", "true");
    button.append(preview, element("span", "feh-label", LABELS[name] ?? name));
    button.addEventListener("click", () => {
      wm.setWallpaper(name);
      sync();
    });
    list.append(button);
    return button;
  });

  const sync = () => {
    const current = wm.wallpaper();
    buttons.forEach((button) => {
      const active = button.dataset.wallpaper === current;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-checked", String(active));
      button.tabIndex = active ? 0 : -1;
    });
  };

  view.append(list);
  body.append(view);
  sync();

  return { destroy: () => view.remove() };
};
