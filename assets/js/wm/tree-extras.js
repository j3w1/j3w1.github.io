/* Pure tree operations for the features ported from the original config that
   the core tree did not need: container focus, marks, swapping, and floating
   rect setters. Kept out of tree.js so the core stays within its budget and
   its tests stay focused. No DOM, imports only tree.js. */

import { findCon, findLeaf, floatingNode, leafIds, pathTo, setFocus } from "./tree.js?v=20260905i";

export const MARK_PATTERN = /^[a-z0-9_-]{1,32}$/;

/* focus parent: from the focused leaf, the nearest container; from a focused
   container, its parent; stops at the root. Returns the container now focused,
   or null when there is nothing above. */
export const focusParent = (ws) => {
  const path = ws.focused ? pathTo(ws.root, ws.focused) : null;
  if (!path?.length) return null;
  const cons = path.map(({ con }) => con);
  if (!ws.conFocus) {
    ws.conFocus = cons.at(-1).id;
    return cons.at(-1);
  }
  const index = cons.findIndex((con) => con.id === ws.conFocus);
  if (index <= 0) return null;
  ws.conFocus = cons[index - 1].id;
  return cons[index - 1];
};

/* focus child: back down the focus path; from the leaf's own parent, the
   leaf itself (conFocus cleared). */
export const focusChild = (ws) => {
  if (!ws.conFocus) return false;
  const path = ws.focused ? pathTo(ws.root, ws.focused) : null;
  if (!path?.length) {
    ws.conFocus = null;
    return true;
  }
  const cons = path.map(({ con }) => con);
  const index = cons.findIndex((con) => con.id === ws.conFocus);
  ws.conFocus = index >= 0 && index < cons.length - 1 ? cons[index + 1].id : null;
  return true;
};

export const focusedCon = (ws) => (ws.conFocus ? findCon(ws.root, ws.conFocus) : null);

export const clearConFocus = (ws) => {
  ws.conFocus = null;
};

/* Marks are unique across the whole state, as in i3: marking a window with a
   name another window holds moves the mark. */
export const setMark = (state, wsName, id, mark) => {
  if (!MARK_PATTERN.test(mark)) return false;
  for (const ws of Object.values(state.workspaces)) {
    for (const leaf of [...leafNodes(ws.root), ...ws.floating]) {
      if (leaf.marks?.includes(mark)) leaf.marks = leaf.marks.filter((value) => value !== mark);
    }
  }
  const ws = state.workspaces[wsName];
  const leaf = findLeaf(ws.root, id)?.node ?? floatingNode(ws, id);
  if (!leaf) return false;
  leaf.marks = [...new Set([...(leaf.marks ?? []), mark])];
  return true;
};

export const unmark = (state, wsName, id, mark) => {
  const ws = state.workspaces[wsName];
  const leaf = findLeaf(ws.root, id)?.node ?? floatingNode(ws, id);
  if (!leaf?.marks?.length) return false;
  leaf.marks = mark ? leaf.marks.filter((value) => value !== mark) : [];
  if (!leaf.marks.length) delete leaf.marks;
  return true;
};

/* The workspace name and leaf carrying a mark, or null. */
export const findMark = (state, mark) => {
  for (const [name, ws] of Object.entries(state.workspaces)) {
    for (const leaf of [...leafNodes(ws.root), ...ws.floating]) {
      if (leaf.marks?.includes(mark)) return { wsName: name, leaf };
    }
  }
  return null;
};

const leafNodes = (root) => {
  const out = [];
  const walk = (node) => {
    if (node.type === "win") out.push(node);
    else node.children.forEach(walk);
  };
  walk(root);
  return out;
};

/* swap container with mark: two leaves trade places in the tree — positions,
   parents, and shares — within one workspace. */
export const swapLeaves = (ws, a, b) => {
  if (a === b) return false;
  const first = findLeaf(ws.root, a);
  const second = findLeaf(ws.root, b);
  if (!first || !second) return false;
  const percentA = first.node.percent;
  first.parent.children[first.index] = second.node;
  second.parent.children[second.index] = first.node;
  first.node.percent = second.node.percent;
  second.node.percent = percentA;
  return true;
};

/* resize set W H and move position center, on a floating window. */
export const resizeFloatingTo = (ws, id, w, h) => {
  const node = floatingNode(ws, id);
  if (!node || !Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return false;
  node.floatRect = { ...node.floatRect, w: Math.round(w), h: Math.round(h) };
  return true;
};

export const centreFloating = (ws, id, bounds) => {
  const node = floatingNode(ws, id);
  if (!node?.floatRect) return false;
  node.floatRect = {
    ...node.floatRect,
    x: Math.round(bounds.x + (bounds.w - node.floatRect.w) / 2),
    y: Math.round(bounds.y + (bounds.h - node.floatRect.h) / 2),
  };
  return true;
};

/* The number of windows a container holds, for the announcement. */
export const conSize = (con) => leafIds(con).length;

export { setFocus };
