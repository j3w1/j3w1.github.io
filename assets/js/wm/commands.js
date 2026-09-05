/* i3-msg: the command language, in one place.

   The launcher and the terminal's `i3-msg` both come through here, so every
   launcher entry is literally an i3 command that round-trips through the same
   parser — the catalogue is generated from the table, not written twice.

   parseCommand is pure and DOM-free: it turns "workspace 2; layout tabbed"
   into a list of { op, args } steps, i3's `;` chaining included. runCommand
   executes those against the facade and answers with "" for success or a
   short reason, the way i3-msg prints its result. */

export const parseCommand = (text) =>
  String(text ?? "")
    .split(";")
    .map((part) => part.trim().replace(/\s+/g, " ").toLowerCase())
    .filter(Boolean)
    .map((part) => {
      const [op, ...args] = part.split(" ");
      return { op, args };
    });

const DIRECTIONS = new Set(["left", "right", "up", "down"]);
const LAYOUTS = new Set(["splith", "splitv", "tabbed", "stacked"]);

/* Each handler returns "" on success or a reason. `ctx` carries what the
   commands need beyond the facade: the keys module (for modes), the workspace
   list, and the session services the launcher used to reach directly. */
const HANDLERS = {
  layout: (wm, ctx, args) => {
    const name = args.join("");
    if (name === "togglesplit" || name === "toggle") return wm.toggleSplit() ? "" : "no change";
    if (name === "stacking") return wm.setLayout("stacked") ? "" : "no change";
    if (name === "default") return wm.setLayout("splith") ? "" : "no change";
    return LAYOUTS.has(name) ? (wm.setLayout(name) ? "" : "no change") : `unknown layout: ${args.join(" ")}`;
  },
  split: (wm, ctx, [orientation = "toggle"]) => {
    if (orientation === "toggle" || orientation === "t") return wm.toggleSplit() ? "" : "no change";
    return wm.split(orientation.startsWith("v") ? "v" : "h") ? "" : "no change";
  },
  fullscreen: (wm) => (wm.toggleFullscreen() ? "" : "no window"),
  kill: (wm) => (wm.kill() ? "" : "no window"),
  floating: (wm) => (wm.toggleFloating() ? "" : "no window"),
  focus: (wm, ctx, [target]) => {
    if (DIRECTIONS.has(target)) return wm.focus(target) ? "" : "nothing that way";
    if (target === "mode_toggle") return wm.toggleFocusMode() ? "" : "nothing floating";
    if (target === "parent") return wm.focusParent?.() ? "" : "no parent";
    if (target === "child") return wm.focusChild?.() ? "" : "no child";
    return "usage: focus left|right|up|down|parent|child|mode_toggle";
  },
  move: (wm, ctx, args) => {
    if (DIRECTIONS.has(args[0])) return wm.move(args[0]) ? "" : "no room";
    if (args[0] === "scratchpad") return wm.scratchpadMove() ? "" : "no window";
    if (args.includes("workspace")) {
      const target = args.at(-1);
      if (target === "back_and_forth") return wm.moveToWorkspaceBackAndForth?.() ? "" : "nothing to go back to";
      const index = Number.parseInt(target, 10);
      const resolved = Number.isFinite(index) ? index : ctx.workspaces.indexOf(target) + 1;
      if (resolved < 1 || resolved > ctx.workspaces.length) return "usage: move to workspace N";
      return wm.moveToWorkspaceIndex(resolved) ? "" : "no window";
    }
    if (args[0] === "position" && args[1] === "center") return wm.centerFloating?.() ? "" : "not floating";
    return "usage: move left|right|up|down | move to workspace N | move scratchpad";
  },
  resize: (wm, ctx, args) => {
    if (args[0] === "set") {
      const [w, h] = args.slice(1).map((value) => Number.parseInt(value, 10));
      return wm.resizeSet?.(w, h) ? "" : "usage: resize set WIDTH HEIGHT (floating only)";
    }
    const [verb, axis, amount = "5"] = args;
    const ppt = Math.max(1, Number.parseInt(amount, 10) || 5);
    const grow = verb === "grow";
    if (!["grow", "shrink"].includes(verb) || !["width", "height"].includes(axis)) return "usage: resize grow|shrink width|height N";
    const direction = axis === "width" ? (grow ? "right" : "left") : (grow ? "down" : "up");
    return wm.resize(direction, ppt) ? "" : "no window";
  },
  scratchpad: (wm) => (wm.scratchpadShow() ? "" : "scratchpad is empty"),
  workspace: (wm, ctx, [target]) => {
    if (target === "next" || target === "prev") return wm.stepWorkspace?.(target === "next" ? 1 : -1) ? "" : "no such workspace";
    if (target === "back_and_forth") return wm.workspaceBackAndForth?.() ? "" : "nothing to go back to";
    const index = Number.parseInt(target, 10);
    if (Number.isFinite(index)) {
      ctx.onWorkspaceRequest(index);
      return "";
    }
    if (!ctx.workspaces.includes(target)) return `no such workspace: ${target}`;
    wm.openWorkspace(target);
    return "";
  },
  restart: (wm) => (wm.restart(), ""),
  reload: (wm) => (wm.reload?.() ? "" : "nothing to reload"),
  exec: (wm, ctx, args) => {
    const program = args[0];
    if (program === "i3lock") return ctx.lock()?.lock() ? "" : "";
    if (program === "lightdm") return (ctx.showGreeter("boot"), "");
    if (program === "j3w1ctl") return (ctx.openCms(), "");
    if (!ctx.apps.includes(program)) return `unknown program: ${program}`;
    wm.spawn(program);
    return "";
  },
  mode: (wm, ctx, [name = "default"]) => (ctx.keys().setMode(name.replaceAll('"', "")) ? "" : `unknown mode: ${name}`),
  bar: (wm, ctx, args) => {
    if (args[0] === "mode") return wm.setBarMode?.(args[1] ?? "toggle") ? "" : "usage: bar mode toggle|hide|dock";
    if (args[0] === "labels") return wm.setBarLabels?.(args[1]) ? "" : "usage: bar labels zh|en";
    return "usage: bar mode toggle|hide|dock | bar labels zh|en";
  },
  gaps: (wm, ctx, args) => (wm.gaps?.(args) ? "" : "usage: gaps inner|outer current|all set|plus|minus N"),
  border: (wm, ctx, [style = "toggle", width]) => (wm.setBorder?.(style, width) ? "" : "no window"),
  sticky: (wm, ctx, [action = "toggle"]) => (wm.setSticky?.(action) ? "" : "sticky needs a floating spawned window"),
  mark: (wm, ctx, [name]) => (wm.mark?.(name) ? "" : "usage: mark NAME"),
  unmark: (wm, ctx, [name]) => (wm.unmark?.(name) ? "" : "no such mark"),
  swap: (wm, ctx, args) => (wm.swapWith?.(args.at(-1)) ? "" : "usage: swap container with mark NAME"),
  exit: (wm) => (wm.logout(), ""),
  i3exit: (wm, ctx, [action = "logout"]) => (wm.power?.(action) ? "" : `unknown action: ${action}`),
  reboot: (wm) => (wm.power?.("reboot") ? "" : "no power management"),
  poweroff: (wm) => (wm.power?.("shutdown") ? "" : "no power management"),
  shutdown: (wm) => (wm.power?.("shutdown") ? "" : "no power management"),
  systemctl: (wm, ctx, [verb, unit]) => {
    if (verb === "restart" && unit === "lightdm") return (ctx.showGreeter("login"), "");
    if (["suspend", "hibernate", "reboot", "poweroff"].includes(verb)) return wm.power?.(verb === "poweroff" ? "shutdown" : verb) ? "" : "no power management";
    return "usage: systemctl suspend|hibernate|reboot|poweroff | systemctl restart lightdm";
  },
  wallpaper: (wm, ctx, [name]) => (wm.setWallpaper(name) ? "" : `unknown wallpaper: ${name}`),
  restore: (wm) => (wm.restoreAll() ? "" : "nothing to restore"),
  lock: (wm, ctx, [value]) => {
    if (!["off", "10m", "30m"].includes(value)) return "usage: lock off|10m|30m";
    ctx.prefs.lock = value;
    ctx.lock()?.reschedule();
    ctx.announce(`idle lock ${value}`);
    return "";
  },
  boot: (wm, ctx, [value]) => {
    if (!["on", "off"].includes(value)) return "usage: boot on|off";
    ctx.prefs.boot = value === "on";
    ctx.announce(`boot sequence ${value}`);
    return "";
  },
  notify: (wm, ctx, [value]) => {
    if (!["on", "off"].includes(value)) return "usage: notify on|off";
    ctx.prefs.notify = value === "on";
    if (value === "on") ctx.dunst.notify("dunst enabled", { key: "dunst" });
    else ctx.announce("notifications off");
    return "";
  },
  nop: () => "",
};

/* Parses `[con_mark=x] focus`-style criteria off the front of a step. Marks
   arrive with the tree features; until then the criterion is honoured by
   focusing the marked window first. */
const splitCriteria = (op, args) => {
  const match = op.match(/^\[con_mark=([a-z0-9_-]+)\]$/);
  if (!match) return { criteria: null, op, args };
  return { criteria: { mark: match[1] }, op: args[0], args: args.slice(1) };
};

export const runCommand = (wm, ctx, text) => {
  const steps = parseCommand(text);
  if (!steps.length) return "empty command";
  const results = [];
  for (const step of steps) {
    const { criteria, op, args } = splitCriteria(step.op, step.args);
    if (criteria && !wm.focusMark?.(criteria.mark)) return `no window marked ${criteria.mark}`;
    const handler = HANDLERS[op];
    if (!handler) return `unknown command: ${op}`;
    const result = handler(wm, ctx, args);
    if (result) results.push(result);
  }
  return results.join("; ");
};

/* The launcher catalogue. Every label is an i3 command that the parser above
   accepts, so a visitor can also type it into `i3-msg` in the terminal. */
export const commandList = (wm, ctx) => {
  const command = (label, aliases, text = label) => ({ label, aliases, run: () => runCommand(wm, ctx, text) });
  const list = [
    command("layout tabbed", "tab tabs w"),
    command("layout stacking", "stack stacked s"),
    command("layout splith", "horizontal"),
    command("layout splitv", "vertical"),
    command("layout toggle split", "e"),
    command("split h", "split horizontal b"),
    command("split v", "split vertical"),
    command("fullscreen toggle", "f max"),
    command("floating toggle", "float drag"),
    command("focus mode_toggle", "focus floating tiling"),
    command("focus parent", "container a"),
    command("kill", "q close window"),
    command("restore", "unkill undo restore all windows"),
    command("restart", "reset restart i3 inplace"),
    command("reload", "shift c reload config"),
    command("scratchpad show", "minimize"),
    command("move scratchpad", "to scratchpad"),
    command("workspace back_and_forth", "previous workspace toggle"),
    command("workspace next", "right workspace"),
    command("workspace prev", "left workspace"),
    command("mode resize", "r resize mode"),
    command("mode system", "0 power system mode"),
    command("mode gaps", "shift g gaps mode"),
    command("bar mode toggle", "m hide bar show bar"),
    command("bar labels zh", "chinese labels"),
    command("bar labels en", "english labels"),
    command("border none", "u borderless"),
    command("border pixel 1", "y thin border"),
    command("border normal", "n titlebar"),
    command("sticky toggle", "shift s every workspace"),
  ];
  ctx.workspaces.forEach((name, index) => {
    list.push(command(`move to workspace ${index + 1}:${name}`, `move ${name} ${index + 1}`, `move to workspace ${index + 1}`));
  });
  ctx.apps.forEach((name) => list.push(command(`exec ${name}`, `run open ${ctx.appLabel(name)}`)));
  ctx.wallpapers.forEach((name) => list.push(command(`wallpaper ${name}`, `feh background ${name}`)));
  list.push(
    { label: "open wiki (how to use this site)", aliases: "help guide manual docs wiki", run: () => ctx.openWiki() },
    command("exec j3w1ctl", "cms admin publish content"),
    command("exec i3lock", "lock screen"),
    command("lock off", "idle disable"),
    command("lock 10m", "idle ten"),
    command("lock 30m", "idle thirty"),
    command("boot on", "greeter lightdm enable"),
    command("boot off", "greeter lightdm disable"),
    command("exit", "log out logout session sign out", "exit"),
    command("exec lightdm", "replay greeter boot sequence"),
    command("i3exit reboot", "restart the machine reboot"),
    command("i3exit shutdown", "power off halt shutdown"),
    command("i3exit suspend", "sleep suspend"),
    command("i3exit hibernate", "hibernate"),
    command("i3exit switch_user", "switch user greeter"),
    command("notify off", "dunst quiet"),
    command("notify on", "dunst"),
  );
  return list;
};
