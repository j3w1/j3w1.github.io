/* i3 layout tree. Pure data operations: no DOM, no imports, no side effects
   outside the tree passed in. Everything here is exercised by ?wm=selftest. */

let conCounter = 0;

export const seedConCounter = (value) => {
  conCounter = Number.isFinite(value) && value > conCounter ? value : conCounter;
};

const nextConId = () => `c${(conCounter += 1)}`;

export const makeLeaf = (id, percent = 1) => ({ id, type: "win", percent });

export const makeCon = (layout, children = [], percent = 1) => ({
  id: nextConId(),
  type: "con",
  layout,
  children,
  focus: 0,
  percent,
});

/* splith and tabbed share the horizontal axis; splitv and stacked the vertical one. */
export const axisOf = (layout) => (layout === "splith" || layout === "tabbed" ? "h" : "v");

export const isTabular = (layout) => layout === "tabbed" || layout === "stacked";

export const eachLeaf = (root, visit) => {
  const walk = (node, parent, index) => {
    if (node.type === "win") return visit(node, parent, index);
    node.children.forEach((child, childIndex) => walk(child, node, childIndex));
  };
  walk(root, null, 0);
};

export const leafIds = (root) => {
  const ids = [];
  eachLeaf(root, (node) => ids.push(node.id));
  return ids;
};

export const findLeaf = (root, id) => {
  let found = null;
  const walk = (node, parent, index) => {
    if (found) return;
    if (node.type === "win") {
      if (node.id === id) found = { node, parent, index };
      return;
    }
    node.children.forEach((child, childIndex) => walk(child, node, childIndex));
  };
  walk(root, null, 0);
  return found;
};

export const findCon = (root, id) => {
  let found = null;
  const walk = (node) => {
    if (found || node.type === "win") return;
    if (node.id === id) {
      found = node;
      return;
    }
    node.children.forEach(walk);
  };
  walk(root);
  return found;
};

/* Root-first path of {con, index} pairs leading to a leaf. */
export const pathTo = (root, id) => {
  const path = [];
  const walk = (node) => {
    if (node.type === "win") return node.id === id;
    for (let index = 0; index < node.children.length; index += 1) {
      if (walk(node.children[index])) {
        path.unshift({ con: node, index });
        return true;
      }
    }
    return false;
  };
  return walk(root) ? path : null;
};

/* The leaf a container's tab or stack row stands for: follow the focus chain down. */
/* When nothing is visible in a direction, focus steps through the nearest
   tabbed or stacked ancestor instead — what makes hidden tab children
   reachable from the keyboard. Returns true when the focus moved. */
export const stepTabular = (ws, direction) => {
  const path = pathTo(ws.root, ws.focused);
  const container = path ? [...path].reverse().find(({ con }) => isTabular(con.layout)) : null;
  if (!container) return false;
  const step = direction === "right" || direction === "down" ? 1 : -1;
  const next = container.con.focus + step;
  if (next < 0 || next >= container.con.children.length) return false;
  container.con.focus = next;
  const leaf = representativeLeaf(container.con.children[next]);
  if (leaf) setFocus(ws, leaf.id);
  return true;
};

export const representativeLeaf = (node) => {
  let current = node;
  while (current.type === "con") {
    if (!current.children.length) return null;
    current = current.children[Math.min(current.focus ?? 0, current.children.length - 1)];
  }
  return current;
};

const shareEvenly = (children) => {
  children.forEach((child) => {
    child.percent = 1 / children.length;
  });
};

const renormalize = (children) => {
  if (!children.length) return;
  const total = children.reduce((sum, child) => sum + (child.percent > 0 ? child.percent : 0), 0);
  if (total > 0) {
    children.forEach((child) => {
      child.percent = (child.percent > 0 ? child.percent : 0) / total;
    });
  } else shareEvenly(children);
};

/* Drop empty containers, collapse single-child containers into their parent, and
   make every sibling group's percents sum to 1. The root is never collapsed. */
export const normalize = (root) => {
  const walk = (node) => {
    if (node.type === "win") return node;
    node.children = node.children
      .map(walk)
      .filter((child) => child.type === "win" || child.children.length > 0);
    node.children = node.children.map((child) => {
      if (child.type === "con" && child.children.length === 1) {
        const only = child.children[0];
        only.percent = child.percent;
        return only;
      }
      return child;
    });
    renormalize(node.children);
    node.focus = Math.min(Math.max(node.focus ?? 0, 0), Math.max(node.children.length - 1, 0));
    return node;
  };
  walk(root);
  return root;
};

export const insertChild = (con, node, index = con.children.length) => {
  const share = 1 / (con.children.length + 1);
  con.children.forEach((child) => {
    child.percent *= 1 - share;
  });
  node.percent = share;
  con.children.splice(index, 0, node);
  con.focus = index;
  return node;
};

export const removeChild = (con, index) => {
  const [removed] = con.children.splice(index, 1);
  renormalize(con.children);
  con.focus = Math.min(con.focus ?? 0, Math.max(con.children.length - 1, 0));
  return removed;
};

export const floatingNode = (ws, id) => ws.floating.find((node) => node.id === id) ?? null;

export const allIds = (ws) => [...leafIds(ws.root), ...ws.floating.map((node) => node.id)];

export const setFocus = (ws, id) => {
  const path = pathTo(ws.root, id);
  if (path) {
    path.forEach(({ con, index }) => {
      con.focus = index;
    });
    ws.focused = id;
    ws.focusMode = "tiling";
    return true;
  }
  if (floatingNode(ws, id)) {
    ws.focused = id;
    ws.focusMode = "floating";
    return true;
  }
  return false;
};

/* Raise a floating window to the top of the stack. */
export const raiseFloating = (ws, id) => {
  const index = ws.floating.findIndex((node) => node.id === id);
  if (index < 0 || index === ws.floating.length - 1) return false;
  ws.floating.push(ws.floating.splice(index, 1)[0]);
  return true;
};

export const LAYOUTS = new Set(["splith", "splitv", "tabbed", "stacked"]);

export const setLayout = (ws, id, layout) => {
  if (!LAYOUTS.has(layout)) return false;
  const location = findLeaf(ws.root, id);
  if (!location) return false;
  const con = location.parent ?? ws.root;
  if (con.layout === layout) return false;
  con.layout = layout;
  return true;
};

export const toggleSplit = (ws, id) => {
  const location = findLeaf(ws.root, id);
  if (!location) return false;
  const con = location.parent ?? ws.root;
  con.layout = axisOf(con.layout) === "h" ? "splitv" : "splith";
  return true;
};

/* i3 marks a leaf so the *next* spawned window splits there. With a mostly fixed
   window set that would be invisible, so `split` instead joins the focused leaf
   with its next sibling (previous, if it is last) into a new nested container.
   A container holding a single child just adopts the orientation. */
export const split = (ws, id, orientation) => {
  const layout = orientation === "h" ? "splith" : "splitv";
  const location = findLeaf(ws.root, id);
  if (!location) return false;
  const parent = location.parent ?? ws.root;
  if (parent.children.length < 2) {
    if (parent.layout === layout) return false;
    parent.layout = layout;
    return true;
  }
  const index = location.index;
  const partner = index + 1 < parent.children.length ? index + 1 : index - 1;
  const low = Math.min(index, partner);
  const high = Math.max(index, partner);
  const first = parent.children[low];
  const second = parent.children[high];
  const con = makeCon(layout, [first, second], first.percent + second.percent);
  first.percent = 0.5;
  second.percent = 0.5;
  con.focus = low === index ? 0 : 1;
  parent.children.splice(low, 2, con);
  parent.focus = low;
  setFocus(ws, id);
  return true;
};

/* Walk outward until an ancestor shares the movement axis, then reorder within it.
   Moving into a sibling container descends into that container's near/far edge.
   If no ancestor shares the axis, wrap the root in a new container of that axis —
   what i3 does when a window is pushed past the edge of its output. */
export const moveLeaf = (ws, id, direction) => {
  const axis = direction === "left" || direction === "right" ? "h" : "v";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const path = pathTo(ws.root, id);
  if (!path) return false;

  let axisMatched = false;
  for (let level = path.length - 1; level >= 0; level -= 1) {
    const { con, index } = path[level];
    if (axisOf(con.layout) !== axis) continue;
    axisMatched = true;
    const target = index + sign;
    if (target < 0 || target >= con.children.length) continue;
    const moving = con.children[index];
    const sibling = con.children[target];
    if (sibling.type === "con" && !isTabular(sibling.layout)) {
      removeChild(con, index);
      insertChild(sibling, moving, sign > 0 ? 0 : sibling.children.length);
    } else {
      con.children[index] = sibling;
      con.children[target] = moving;
      const movingPercent = moving.percent;
      moving.percent = sibling.percent;
      sibling.percent = movingPercent;
      con.focus = target;
    }
    normalize(ws.root);
    setFocus(ws, id);
    return true;
  }

  if (axisMatched) return false;

  const location = findLeaf(ws.root, id);
  if (!location || !location.parent) return false;
  removeChild(location.parent, location.index);
  normalize(ws.root);
  const inner = makeCon(ws.root.layout, ws.root.children, 0.5);
  inner.focus = ws.root.focus ?? 0;
  const wrapper = makeCon(axis === "h" ? "splith" : "splitv", []);
  const leaf = location.node;
  leaf.percent = 0.5;
  wrapper.children = sign > 0 ? [inner, leaf] : [leaf, inner];
  wrapper.focus = sign > 0 ? 1 : 0;
  ws.root = wrapper;
  normalize(ws.root);
  setFocus(ws, id);
  return true;
};

const MIN_PERCENT = 0.08;

export const resizeLeaf = (ws, id, direction, ppt) => {
  const axis = direction === "left" || direction === "right" ? "h" : "v";
  const grow = direction === "right" || direction === "down";
  const delta = ppt / 100;
  const path = pathTo(ws.root, id);
  if (!path) return false;

  for (let level = path.length - 1; level >= 0; level -= 1) {
    const { con, index } = path[level];
    if (isTabular(con.layout) || axisOf(con.layout) !== axis) continue;
    if (con.children.length < 2) continue;
    const preferred = grow ? index + 1 : index - 1;
    const partner = preferred >= 0 && preferred < con.children.length
      ? preferred
      : (grow ? index - 1 : index + 1);
    if (partner < 0 || partner >= con.children.length) continue;
    const moving = con.children[index];
    const neighbour = con.children[partner];
    const applied = Math.max(
      -(moving.percent - MIN_PERCENT),
      Math.min(delta, neighbour.percent - MIN_PERCENT),
    );
    if (applied === 0) return false;
    moving.percent += applied;
    neighbour.percent -= applied;
    return true;
  }
  return false;
};

export const toggleFullscreen = (ws, id) => {
  ws.fullscreen = ws.fullscreen === id ? null : id;
  return true;
};

const centredRect = (rect, bounds) => {
  const width = Math.round(Math.min(bounds.w * 0.66, Math.max(rect?.w ?? 0, 320)));
  const height = Math.round(Math.min(bounds.h * 0.66, Math.max(rect?.h ?? 0, 220)));
  return {
    x: Math.round(bounds.x + (bounds.w - width) / 2),
    y: Math.round(bounds.y + (bounds.h - height) / 2),
    w: Math.max(width, 1),
    h: Math.max(height, 1),
  };
};

export const toggleFloating = (ws, id, bounds) => {
  const floated = floatingNode(ws, id);
  if (floated) {
    ws.floating.splice(ws.floating.indexOf(floated), 1);
    delete floated.floating;
    delete floated.floatRect;
    insertChild(ws.root, floated, ws.root.children.length);
    normalize(ws.root);
    setFocus(ws, id);
    return true;
  }
  const location = findLeaf(ws.root, id);
  if (!location || !location.parent) return false;
  const rect = location.node.rect;
  removeChild(location.parent, location.index);
  normalize(ws.root);
  location.node.floating = true;
  location.node.floatRect = centredRect(rect, bounds);
  ws.floating.push(location.node);
  ws.focused = id;
  ws.focusMode = "floating";
  return true;
};

/* Focus the nearest remaining window so focus is never stranded on a hidden node. */
const refocusAfterRemoval = (ws) => {
  const remaining = leafIds(ws.root);
  if (remaining.length) return setFocus(ws, remaining[0]);
  if (ws.floating.length) return setFocus(ws, ws.floating[ws.floating.length - 1].id);
  ws.focused = null;
  return false;
};

export const detachLeaf = (ws, id) => {
  const floated = floatingNode(ws, id);
  if (floated) {
    ws.floating.splice(ws.floating.indexOf(floated), 1);
    if (ws.fullscreen === id) ws.fullscreen = null;
    if (ws.focused === id) refocusAfterRemoval(ws);
    return floated;
  }
  const location = findLeaf(ws.root, id);
  if (!location || !location.parent) return null;
  removeChild(location.parent, location.index);
  normalize(ws.root);
  if (ws.fullscreen === id) ws.fullscreen = null;
  if (ws.focused === id) refocusAfterRemoval(ws);
  return location.node;
};

export const killLeaf = (ws, id) => {
  const node = detachLeaf(ws, id);
  if (!node) return null;
  if (!node.spawned && !ws.killed.includes(id)) ws.killed.push(id);
  return node;
};

export const restoreKilled = (ws) => {
  if (!ws.killed.length) return false;
  ws.killed.splice(0).forEach((id) => {
    insertChild(ws.root, makeLeaf(id), ws.root.children.length);
  });
  normalize(ws.root);
  return true;
};

export const attachLeaf = (ws, node) => {
  delete node.floating;
  delete node.floatRect;
  insertChild(ws.root, node, ws.root.children.length);
  normalize(ws.root);
  setFocus(ws, node.id);
  return true;
};

export const moveToWorkspace = (state, id, fromName, toName) => {
  const from = state.workspaces[fromName];
  const to = state.workspaces[toName];
  if (!from || !to || fromName === toName) return false;
  const node = detachLeaf(from, id);
  if (!node) return false;
  const index = to.killed.indexOf(id);
  if (index >= 0) to.killed.splice(index, 1);
  attachLeaf(to, node);
  return true;
};

export const moveToScratchpad = (state, ws, id) => {
  const node = detachLeaf(ws, id);
  if (!node) return false;
  delete node.floating;
  delete node.floatRect;
  state.scratchpad.push(node);
  return true;
};

/* i3 semantics: `scratchpad show` hides the shown scratchpad window if it is
   focused, focuses it if it is visible but not focused, and otherwise shows
   the next one. Hidden windows go to the back of the queue, so repeated
   presses cycle through every scratchpad window rather than toggling one. */
export const showScratchpad = (state, ws, bounds) => {
  if (state.scratchpadShown) {
    const shown = floatingNode(ws, state.scratchpadShown);
    if (shown) {
      if (ws.focused !== shown.id) {
        ws.focused = shown.id;
        ws.focusMode = "floating";
        return true;
      }
      ws.floating.splice(ws.floating.indexOf(shown), 1);
      delete shown.floating;
      delete shown.floatRect;
      state.scratchpad.push(shown);
      state.scratchpadShown = null;
      refocusAfterRemoval(ws);
      return true;
    }
    state.scratchpadShown = null;
  }
  const node = state.scratchpad.shift();
  if (!node) return false;
  node.floating = true;
  node.floatRect = centredRect(node.rect, bounds);
  ws.floating.push(node);
  state.scratchpadShown = node.id;
  ws.focused = node.id;
  ws.focusMode = "floating";
  return true;
};

/* Reconcile persisted state against the windows actually present in the document.
   Unknown ids are dropped, live ids missing from the tree are appended to their
   default workspace, and any duplicate id anywhere forces a full reset. */
export const validate = (state, liveIds, defaults) => {
  if (!state || typeof state !== "object" || !state.workspaces) return defaults;
  const live = new Set(liveIds);
  const seen = new Set();
  let duplicated = false;

  const names = Object.keys(defaults.workspaces);
  for (const name of names) {
    const ws = state.workspaces[name];
    if (!ws || !ws.root || ws.root.type !== "con") return defaults;
    ws.name = name;
    ws.floating = Array.isArray(ws.floating) ? ws.floating : [];
    ws.killed = [];
    ws.scratchpad = undefined;

    /* Persisted numbers are coerced, not trusted: a NaN percent or a malformed
       floatRect would otherwise reach the renderer as "NaNpx". */
    const finite = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);
    const prune = (node) => {
      if (!node || typeof node !== "object") return null;
      if (node.type === "win") {
        if (!live.has(node.id) || seen.has(node.id)) {
          if (seen.has(node.id)) duplicated = true;
          return null;
        }
        seen.add(node.id);
        node.percent = finite(node.percent, 1);
        delete node.floating;
        delete node.floatRect;
        return node;
      }
      if (node.type !== "con" || !Array.isArray(node.children)) return null;
      seedConCounter(Number.parseInt(String(node.id).slice(1), 10) || 0);
      node.layout = LAYOUTS.has(node.layout) ? node.layout : "splith";
      node.percent = finite(node.percent, 1);
      node.focus = Number.isInteger(node.focus) && node.focus >= 0 ? node.focus : 0;
      node.children = node.children.map(prune).filter(Boolean);
      return node.children.length ? node : null;
    };

    ws.root = prune(ws.root) ?? defaults.workspaces[name].root;
    ws.floating = ws.floating.filter((node) => {
      if (node?.type !== "win" || !live.has(node.id) || seen.has(node.id)) {
        if (node && seen.has(node.id)) duplicated = true;
        return false;
      }
      seen.add(node.id);
      node.floating = true;
      const rect = node.floatRect;
      const valid = rect && ["x", "y", "w", "h"].every((key) => Number.isFinite(rect[key]));
      node.floatRect = valid ? { x: rect.x, y: rect.y, w: Math.max(rect.w, 1), h: Math.max(rect.h, 1) } : null;
      return true;
    });
    normalize(ws.root);
    ws.fullscreen = live.has(ws.fullscreen) ? ws.fullscreen : null;
    ws.focusMode = ws.focusMode === "floating" ? "floating" : "tiling";
    if (!ws.focused || !live.has(ws.focused)) ws.focused = leafIds(ws.root)[0] ?? null;
  }

  if (duplicated) return defaults;

  state.scratchpad = Array.isArray(state.scratchpad)
    ? state.scratchpad.filter((node) => {
        if (node?.type !== "win" || !live.has(node.id) || seen.has(node.id)) return false;
        seen.add(node.id);
        return true;
      })
    : [];
  /* The shown scratchpad window survives a reload only while it is still a
     floating window somewhere; otherwise it would silently escape the
     scratchpad and `-` would pop a different window. */
  const shownIn = names.find((name) => floatingNode(state.workspaces[name], state.scratchpadShown));
  state.scratchpadShown = shownIn ? state.scratchpadShown : null;

  /* Any window in the document but absent from the tree joins its home workspace. */
  for (const name of names) {
    for (const id of leafIds(defaults.workspaces[name].root)) {
      if (seen.has(id)) continue;
      seen.add(id);
      insertChild(state.workspaces[name].root, makeLeaf(id), state.workspaces[name].root.children.length);
    }
    normalize(state.workspaces[name].root);
    if (!state.workspaces[name].focused) {
      state.workspaces[name].focused = leafIds(state.workspaces[name].root)[0] ?? null;
    }
  }

  state.version = defaults.version;
  state.wallpaper = typeof state.wallpaper === "string" ? state.wallpaper : defaults.wallpaper;
  return state;
};
