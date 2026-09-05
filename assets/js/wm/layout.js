/* Rect arithmetic for the layout tree. Pure: takes a workspace and a bounding
   rect, returns where everything goes. No DOM, no measurement, no side effects
   beyond caching each node's rect for hit-testing. */

import { isTabular, representativeLeaf } from "./tree.js?v=20260905f";

export const GEOMETRY = Object.freeze({
  tabHeight: 23,
  stackRow: 23,
  gapInner: 3,
  minPx: 120,
  gutterGrab: 6,
});

/* Cumulative rounded offsets, so children tile their parent exactly: rounding
   each edge once and taking sizes as differences leaves no seams or overlaps. */
const edgesFor = (percents, total) => {
  const edges = [0];
  let accumulated = 0;
  for (let index = 0; index < percents.length; index += 1) {
    accumulated += percents[index];
    edges.push(Math.round(accumulated * total));
  }
  edges[edges.length - 1] = total;
  return edges;
};

const hideSubtree = (node, out) => {
  if (node.type === "win") {
    out.hidden.add(node.id);
    return;
  }
  node.children.forEach((child) => hideSubtree(child, out));
};

const place = (node, rect, out, geometry) => {
  if (node.type === "win") {
    out.tiles.set(node.id, rect);
    node.rect = rect;
    return;
  }
  layoutCon(node, rect, out, geometry);
};

function layoutCon(con, rect, out, geometry) {
  con.rect = rect;
  const children = con.children;
  if (!children || !children.length) return;
  const focus = Math.min(Math.max(con.focus ?? 0, 0), children.length - 1);

  if (isTabular(con.layout)) {
    const tabbed = con.layout === "tabbed";
    const barHeight = Math.min(
      tabbed ? geometry.tabHeight : geometry.stackRow * children.length,
      Math.max(rect.h, 0),
    );
    const bar = { x: rect.x, y: rect.y, w: rect.w, h: barHeight };
    const body = {
      x: rect.x,
      y: rect.y + barHeight,
      w: rect.w,
      h: Math.max(rect.h - barHeight, 0),
    };
    const columns = tabbed ? edgesFor(children.map(() => 1 / children.length), rect.w) : null;
    const tabs = children.map((child, index) => {
      const leaf = representativeLeaf(child);
      return {
        id: leaf ? leaf.id : null,
        childIndex: index,
        active: index === focus,
        rect: tabbed
          ? { x: rect.x + columns[index], y: rect.y, w: columns[index + 1] - columns[index], h: barHeight }
          : { x: rect.x, y: rect.y + index * geometry.stackRow, w: rect.w, h: geometry.stackRow },
      };
    });
    out.decos.push({ conId: con.id, kind: con.layout, rect: bar, tabs });
    children.forEach((child, index) => {
      if (index === focus) place(child, body, out, geometry);
      else hideSubtree(child, out);
    });
    return;
  }

  const horizontal = con.layout === "splith";
  const span = horizontal ? rect.w : rect.h;
  const gaps = geometry.gapInner * (children.length - 1);
  const available = Math.max(span - gaps, 0);
  const edges = edgesFor(children.map((child) => child.percent), available);

  children.forEach((child, index) => {
    const offset = edges[index] + index * geometry.gapInner;
    const size = edges[index + 1] - edges[index];
    place(
      child,
      horizontal
        ? { x: rect.x + offset, y: rect.y, w: size, h: rect.h }
        : { x: rect.x, y: rect.y + offset, w: rect.w, h: size },
      out,
      geometry,
    );
    if (index === children.length - 1) return;
    out.gutters.push({
      conId: con.id,
      index,
      orientation: horizontal ? "h" : "v",
      rect: horizontal
        ? { x: rect.x + offset + size, y: rect.y, w: geometry.gapInner, h: rect.h }
        : { x: rect.x, y: rect.y + offset + size, w: rect.w, h: geometry.gapInner },
    });
  });
}

export const clampFloating = (rect, bounds, minVisible = 48) => {
  const width = Math.max(Math.min(rect.w, bounds.w), 160);
  const height = Math.max(Math.min(rect.h, bounds.h), 96);
  return {
    x: Math.round(Math.min(Math.max(rect.x, bounds.x - width + minVisible), bounds.x + bounds.w - minVisible)),
    y: Math.round(Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.h - minVisible)),
    w: Math.round(width),
    h: Math.round(height),
  };
};

export const computeWorkspace = (ws, bounds, geometry = GEOMETRY) => {
  const out = {
    tiles: new Map(),
    floats: new Map(),
    hidden: new Set(),
    decos: [],
    gutters: [],
  };

  if (ws.fullscreen) {
    out.tiles.set(ws.fullscreen, { ...bounds });
    hideSubtree(ws.root, out);
    out.hidden.delete(ws.fullscreen);
    ws.floating.forEach((node) => {
      if (node.id !== ws.fullscreen) out.hidden.add(node.id);
    });
    return out;
  }

  layoutCon(ws.root, bounds, out, geometry);
  ws.floating.forEach((node) => {
    const rect = clampFloating(node.floatRect ?? bounds, bounds);
    node.floatRect = rect;
    node.rect = rect;
    out.floats.set(node.id, rect);
  });
  return out;
};

/* Which gutter, if any, sits under a point — used for cursor affordance and drag start. */
export const gutterAt = (layoutResult, point, grab) => {
  for (const gutter of layoutResult.gutters) {
    const { rect } = gutter;
    const inflateX = gutter.orientation === "h" ? grab : 0;
    const inflateY = gutter.orientation === "v" ? grab : 0;
    if (
      point.x >= rect.x - inflateX && point.x <= rect.x + rect.w + inflateX &&
      point.y >= rect.y - inflateY && point.y <= rect.y + rect.h + inflateY
    ) return gutter;
  }
  return null;
};

export const tabAt = (layoutResult, point) => {
  for (const deco of layoutResult.decos) {
    for (const tab of deco.tabs) {
      const { rect } = tab;
      if (
        point.x >= rect.x && point.x <= rect.x + rect.w &&
        point.y >= rect.y && point.y <= rect.y + rect.h
      ) return { deco, tab };
    }
  }
  return null;
};
