/* cmatrix. Pure eye candy, used both as a window and as the i3lock backdrop.
   Renders a single static frame under prefers-reduced-motion and stops entirely
   while the tab is hidden. */

import { element } from "../dom.js?v=20260905c";
import { media } from "../session.js?v=20260905c";

const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789j3w1";

export const createMatrix = ({ body, density = 1 }) => {
  const canvas = element("canvas", "cmatrix");
  canvas.setAttribute("aria-hidden", "true");
  body.append(canvas);
  const context = canvas.getContext("2d");
  let columns = [];
  let raf = 0;
  let cell = 14;

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = body.clientWidth;
    const height = body.clientHeight;
    if (!width || !height) return false;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    cell = 14;
    const count = Math.max(1, Math.floor((width / cell) * density));
    columns = Array.from({ length: count }, () => Math.random() * (height / cell));
    return true;
  };

  const draw = () => {
    const width = body.clientWidth;
    const height = body.clientHeight;
    context.fillStyle = "rgba(5, 3, 3, 0.09)";
    context.fillRect(0, 0, width, height);
    context.font = `${cell}px "JetBrains Mono", monospace`;
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
    const width = body.clientWidth;
    const height = body.clientHeight;
    context.fillStyle = "#050303";
    context.fillRect(0, 0, width, height);
    context.font = `${cell}px "JetBrains Mono", monospace`;
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

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onResize, { passive: true });
  start();

  return {
    refresh: onResize,
    destroy: () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      canvas.remove();
    },
  };
};
