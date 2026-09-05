#!/usr/bin/env node
/* Renders favicon.svg into the raster icons some clients still demand
   (favicon.ico, the Apple touch icon, the manifest icons) and paints the
   default social card. Run by hand with `npm run icons`; the results are
   committed. Playwright's Chromium does the rasterising, so these files are
   not part of the byte-identical `npm run check` — PNG encoding differs across
   browser versions — but a contract test asserts they exist with the right
   magic bytes and dimensions. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = await fs.readFile(path.join(repoRoot, "favicon.svg"), "utf8");
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const raster = async (size) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:#0c0909}img{display:block;width:${size}px;height:${size}px}</style><img src="${dataUrl}">`);
  await page.locator("img").waitFor();
  return page.screenshot({ type: "png", clip: { x: 0, y: 0, width: size, height: size } });
};

/* An .ico that wraps one PNG: a 6-byte header, one 16-byte directory entry,
   then the PNG bytes. Every modern browser and Windows accept it. */
const icoFromPng = (png, size) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
};

await fs.mkdir(path.join(repoRoot, "assets", "icons"), { recursive: true });
await fs.mkdir(path.join(repoRoot, "assets", "social"), { recursive: true });
await fs.writeFile(path.join(repoRoot, "favicon.ico"), icoFromPng(await raster(32), 32));
await fs.writeFile(path.join(repoRoot, "apple-touch-icon.png"), await raster(180));
await fs.writeFile(path.join(repoRoot, "assets", "icons", "icon-192.png"), await raster(192));
await fs.writeFile(path.join(repoRoot, "assets", "icons", "icon-512.png"), await raster(512));

/* The social card: the desktop's wordmark on its black, with the name under
   it, at the 1200×630 every preview renderer expects. */
const fontCss = (await fs.readFile(path.join(repoRoot, "assets", "css", "site.css"), "utf8"))
  .match(/\/\* @generated-fonts:start \*\/[\s\S]*?\/\* @generated-fonts:end \*\//)[0]
  .replaceAll('url("../fonts/', `url("file:///${path.join(repoRoot, "assets", "fonts").replaceAll("\\", "/")}/`);
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<!doctype html><style>
${fontCss}
html,body{margin:0;width:1200px;height:630px;background:#0c0909;color:#e99499;font-family:"SauceCodePro NFM",monospace;overflow:hidden}
.card{position:relative;width:1200px;height:630px;display:flex;flex-direction:column;justify-content:center;padding:0 96px;box-sizing:border-box}
.bar{position:absolute;top:0;left:0;right:0;height:34px;background:#190b0b;border-bottom:1px solid #5b1714;display:flex;align-items:center;padding:0 16px;gap:18px;font-size:16px;color:#bd787d}
.bar b{color:#0c0909;background:#c81a1a;padding:0 10px;height:34px;line-height:34px;font-weight:400}
.mark{font-size:128px;font-weight:700;color:#ffa2a7;letter-spacing:-0.02em;line-height:1}
.mark span{color:#e53935}
.name{margin-top:26px;font-size:34px;color:#e99499}
.tag{margin-top:10px;font-size:24px;color:#bd787d}
.prompt{position:absolute;left:96px;bottom:54px;font-size:22px;color:#bd787d}
.prompt i{font-style:normal;color:#ffa2a7}
</style><div class="card"><div class="bar"><b>1:home</b><span>2:writing</span><span>3:projects</span><span>4:photography</span><span>5:books</span><span>6:elsewhere</span><span>7:about</span></div>
<div class="mark">j3w1<span>-i3</span></div><div class="name">申杰 / j3w1 — writer · software engineer</div><div class="tag">a working i3 window manager, in the browser · j3w1.github.io</div>
<div class="prompt"><i>j3w1@manjaro</i> ~ $ whoami</div></div>`);
await page.evaluate(() => document.fonts.ready);
await fs.writeFile(path.join(repoRoot, "assets", "social", "default.png"), await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 } }));
await browser.close();
console.log("wrote favicon.ico, apple-touch-icon.png, assets/icons/icon-192.png, icon-512.png, assets/social/default.png");
