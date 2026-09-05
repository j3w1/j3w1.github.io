/* cmatrix. Pure eye candy.
   Renders a single static frame under prefers-reduced-motion and stops entirely
   while the tab is hidden. */

import { element } from "../dom.js?v=20260905h";
import { media } from "../session.js?v=20260905h";

const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789j3w1";

/* The canvas cannot inherit CSS, so the page's own font stack is read once. */
const fontFamily = getComputedStyle(document.body).fontFamily || "monospace";

export const createMatrix = ({ body }) => {
  const canvas = element("canvas", "cmatrix");
  canvas.setAttribute("aria-hidden", "true");
  body.append(canvas);
  const context = canvas.getContext("2d");
  let columns = [];
  let raf = 0;
  let cell = 14;
  let width = 0;
  let height = 0;

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = body.clientWidth;
    height = body.clientHeight;
    if (!width || !height) return false;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    cell = 14;
    const count = Math.max(1, Math.floor(width / cell));
    columns = Array.from({ length: count }, () => Math.random() * (height / cell));
    return true;
  };

  const draw = () => {
    context.fillStyle = "rgba(5, 3, 3, 0.09)";
    context.fillRect(0, 0, width, height);
    context.font = `${cell}px ${fontFamily}`;
    columns.forEach((row, index) => {
      const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      const x = (index * width) / columns.length;
      const y = row * cell;
      context.fillStyle = "#ffa2a7";
      context.fillText(glyph, x, y);
      context.fillStyle = "#911410";
      context.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], x, y - cell * 2);
      columns[index] = y > height && Math.random() > 0.975 ? 0 : row + 0.6;
    });
    raf = requestAnimationFrame(draw);
  };

  const staticFrame = () => {
    context.fillStyle = "#050303";
    context.fillRect(0, 0, width, height);
    context.font = `${cell}px ${fontFamily}`;
    context.fillStyle = "#911410";
    for (let column = 0; column < columns.length; column += 1) {
      for (let row = 0; row < height / cell; row += 3) {
        context.fillText(
          GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
          (column * width) / columns.length,
          row * cell,
        );
      }
    }
  };

  const start = () => {
    if (raf || !resize()) return;
    if (media.reducedMotion.matches) {
      staticFrame();
      return;
    }
    raf = requestAnimationFrame(draw);
  };

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
  const onResize = () => {
    stop();
    start();
  };

  /* The tile, not the window, is what changes size under a gutter drag; and a
     zero-sized body means the window is hidden, which stops the loop. */
  const observer = new ResizeObserver(onResize);
  observer.observe(body);
  document.addEventListener("visibilitychange", onVisibility);
  start();

  return {
    destroy: () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.remove();
    },
  };
};
