/* The desktop's chrome handlers: title-bar buttons, the power menu, the
   restore link, the tablist keys, and the resize plumbing. Everything here is
   a document- or window-level listener that answers to the facade; nothing
   here owns state. installChrome returns the function that removes them all,
   so a restart in place never stacks a second set. */

import { listen, rafBatch } from "./dom.js?v=20260905i";

export const installChrome = ({ wm, windows, renderer, restoreFocus, isBlocked, onResize, root, power }) => {
  const cleanup = [];

  /* Title bar buttons: the decorative marks become real controls. */
  cleanup.push(listen(document, "click", (event) => {
    if (isBlocked()) return;
    const button = event.target.closest?.("[data-wm-action]");
    if (!button) return;
    const id = button.closest("[data-wm-window]")?.dataset.wmWindow;
    if (!id) return;
    event.preventDefault();
    wm.focusWindow(id, { moveBrowserFocus: false });
    if (button.dataset.wmAction === "close") wm.kill();
    else if (button.dataset.wmAction === "maximize") wm.toggleFullscreen();
    else wm.scratchpadMove();
  }));

  const powerToggle = document.querySelector("#power-menu-toggle");
  if (powerToggle) cleanup.push(listen(powerToggle, "click", () => wm.togglePowerMenu()));

  /* The nagbar's buttons are the pointer's route to every session action the
     system mode offers from the keyboard (gesture parity). */
  const powerMenu = document.querySelector("#power-menu");
  if (powerMenu) cleanup.push(listen(powerMenu, "click", (event) => {
    const action = event.target.closest?.("[data-power]")?.dataset.power;
    if (!action) return;
    wm.togglePowerMenu(false);
    power(action);
  }));

  cleanup.push(listen(document, "keydown", (event) => {
    if (event.key !== "Escape" || !wm.powerMenuIsOpen()) return;
    event.preventDefault();
    wm.togglePowerMenu(false);
  }));

  cleanup.push(listen(document, "click", (event) => {
    if (isBlocked()) return;
    const restore = event.target.closest?.("[data-wm-restore]");
    if (!restore) return;
    event.preventDefault();
    wm.restoreAll();
    renderer.renderNow();
    restoreFocus(null);
  }));

  /* Tablist keyboard support: the tab strip is one tab stop with arrow keys.
     Activation goes through the facade directly — a synthetic click() fires no
     pointer event and would leave the visible panel unchanged. */
  cleanup.push(listen(document, "keydown", (event) => {
    if (isBlocked()) return;
    const tab = event.target.closest?.(".wm-tab");
    if (!tab) return;
    const tabs = [...tab.parentElement.children];
    const index = tabs.indexOf(tab);
    const map = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    const next = map[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    if (!target) return;
    wm.focusTab(target.dataset.wmCon, Number(target.dataset.wmIndex), target.dataset.wmTab, { moveBrowserFocus: false });
    target.focus({ preventScroll: true });
  }));

  cleanup.push(listen(document, "wm:focus-window", (event) => {
    const id = event.detail?.id;
    if (id && windows.has(id)) wm.focusWindow(id);
  }));

  /* One frame per burst of resize events; the callback decides what to do. */
  const resize = rafBatch(onResize);
  cleanup.push(listen(window, "resize", resize, { passive: true }));
  for (const query of wm.mediaQueries?.() ?? []) {
    if (query.addEventListener) cleanup.push(listen(query, "change", resize));
  }

  const visualViewport = window.visualViewport;
  if (visualViewport) {
    cleanup.push(listen(visualViewport, "resize", () => {
      root.style.setProperty("--vv-offset", `${visualViewport.offsetTop}px`);
    }));
  }

  return () => {
    for (const remove of cleanup) remove();
    cleanup.length = 0;
  };
};
