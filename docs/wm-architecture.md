# Window manager architecture

The public site is a working i3 window manager written in dependency-free ES modules under
`assets/js/wm/`. No npm packages, no bundler, no build step: GitHub Pages serves the files verbatim.

For the visitor-facing guide see [wm-usage.md](wm-usage.md). For the rules the implementation must
obey see [wm-accessibility.md](wm-accessibility.md).

---

## 1. The rule everything else follows from

**Containers are virtual. Authored windows are never reparented.**

`public-content.js` resolves `document.querySelector('[data-content-list="writing"]')` and
`[data-content-detail="photography"]` *after* an awaited `fetch`, and the photo viewer checks
`returnFocus?.isConnected`. Any window manager that wrapped windows in generated containers, cloned
nodes, or reordered the DOM to match its tree would eventually break the content renderer in ways
that only show up once content is published.

So there are two kinds of window:

| Kind | Declared | May the WM create/move/remove it? |
| --- | --- | --- |
| **Authored** — holds site content, declared in `index.html` | `data-wm-window` in the markup | **No.** Only `style`, `hidden`, `class`, `tabindex`, and ARIA attributes. |
| **Spawned** — `neofetch`, `htop`, `cmatrix`, `feh`, extra terminals | created at runtime, carries `.wm-spawned` | Yes, freely. |

Structural changes to authored content — splitting the writing window into an index window and a
reader window — are made **in `index.html`**, never at runtime. `boot.js` asserts at startup that
every content hook still resolves to exactly one element, and `wm-contract.test.js` asserts the same
thing against the source.

Closing an authored window only hides it, and killed windows are **never persisted**, so reloading
always restores a complete desktop.

## 2. Rects, not nested flex

`layout.js` computes an absolute `{x, y, w, h}` for every visible window in one pass; `render.js`
writes those as `left/top/width/height`. There are no container elements in the DOM at all.

Why not nested flex or grid:

1. Nested boxes *require* real container elements, which would mean reparenting windows on every
   `split`, `layout tabbed`, and `move` — violating §1.
2. Explicit pixel rects make geometry independent of content. When `content-index.json` lands and
   injects table rows, min-content contributions cannot shift the layout; content just scrolls
   inside a fixed box.
3. Resizing is one `percent` write plus one rAF, not a `grid-template-columns` rebuild.
4. Tab strips are rect arithmetic (`rect.y += tabHeight`); gaps are rect deflation.
5. Floating and tiling share one coordinate space, one z-order stack, one hit test.

Children tile their parent **exactly**: cumulative edges are rounded once and sizes taken as
differences, so there are no seams or overlapping pixels at any width. This is asserted in both
`wm-tree.test.js` and the browser suite.

Geometry constants that must track the responsive breakpoints (`--gap`, `--wm-tab-height`,
`--wm-stack-row`) are read from CSS, so the stylesheet stays the single source of truth for how big
things are at a given viewport.

**The window manager never animates a rect.** No transitions on `left/top/width/height`. That
satisfies `prefers-reduced-motion` structurally and keeps dragging cheap.

## 3. The tree

```js
WmNode = {
  id, type: "con" | "win", percent,          // percent: share of the parent's main axis
  layout?: "splith" | "splitv" | "tabbed" | "stacked",
  children?, focus?,                          // containers
  floating?, floatRect?, spawned?, rect?,     // leaves (rect is computed, never persisted)
}

WmWorkspace = { name, root, floating[], killed[], focused, fullscreen, focusMode, userTouched }
WmState     = { version, workspaces, scratchpad[], scratchpadShown, modPreference, wallpaper }
```

`splith` and `tabbed` are the horizontal axis; `splitv` and `stacked` the vertical one — the same
mapping i3 uses.

### move

Walk outward until an ancestor shares the movement axis, then reorder within it. Moving into a
sibling container descends to that container's near or far edge. If no ancestor shares the axis, the
root is wrapped in a new container of that axis — what i3 does when a window is pushed past the edge
of its output. At the edge of a matching-axis root the move is refused, because there is no second
monitor to move to.

### split — a documented deviation

i3 marks a leaf so the *next spawned* window splits there. With a mostly fixed window set that would
be invisible, so `split` instead joins the focused leaf with its next sibling (previous, if it is
last) into a new nested container, inheriting their combined share. A container holding a single
child simply adopts the orientation. This becomes fully meaningful once `move to workspace N` and
spawned applications pile several windows onto one workspace.

### focus

Geometric, like i3: the nearest centre in the requested direction, ties broken on the perpendicular
axis. When nothing is visible that way, focus steps through the nearest tabbed or stacked container
instead — which is what makes tab children reachable from the keyboard.

## 4. Modules

| File | Responsibility |
| --- | --- |
| `tree.js` | Pure tree operations. No DOM, no imports. |
| `layout.js` | Pure rect arithmetic. Imports only `tree.js`. |
| `defaults.js` | Default layouts; percents match the CSS grid fractions of the fallback. |
| `render.js` | The only module that writes geometry. Reconciles tab bars and grips. |
| `pointer.js` | Click-to-focus, title-bar drag, floating resize, gutter drag. |
| `keys.js` | Keymap and binding modes. |
| `touch.js` | Swipe and long-press. Loaded only on coarse pointers. |
| `bar.js` | i3status blocks, mode indicator, workspace counts and urgency. |
| `notify.js` | dunst toasts. Visual only. |
| `a11y.js` | The announcer and the focus fallback chain. |
| `session.js` | Preferences, capability detection, named media queries. |
| `store.js` | `localStorage` persistence. |
| `greeter.js`, `idle-lock.js` | Session curtains. Loaded on demand. |
| `apps/` | `shell`, `neofetch`, `htop`, `cmatrix`, `feh`. |
| `boot.js` | The facade, and the only file that knows about all of the above. |

Dependency direction is strictly one way: `site.js → wm/*`. The window manager never imports
`site.js`; it receives `onWorkspaceRequest`, `isBlocked`, and `openLauncher` as injected callbacks,
so it knows nothing about routing, the launcher, or the help dialog.

`site.js` keeps hash routing, the launcher, the help dialog, the projects application, and the
j3w1ctl button. It imports `wm/boot.js` **statically**: a dynamic import would resolve after first
paint and guarantee a visible reflow from the fallback grid to the window manager's layout.

## 5. Boot and the fallback path

```
1. Inline <head> script (synchronous, pre-paint)
   → module-support probe sets html.js
   → html[data-wm="off"] only if the window manager cannot run
   → html[data-boot="greeter"] if there is no stored session and this is not a deep link
2. site.css + desktop.css applied. Fallback grids describe the layout.
3. site.js executes; createWm() runs synchronously inside try/catch:
   inventory → load + validate → compute → write styles → html.classList.add("wm-active")
4. public-content.js starts its fetch. On resolve, [data-content-list] is unmoved and unique;
   content lands inside pixel-sized windows and cannot reflow anything.
```

Two flags, deliberately separate:

- `html[data-wm="off"]` marks a **failed or impossible boot**, so the stacked fallback applies.
- `html.wm-active` is the **fact**, added only after a successful synchronous boot.

**All fallback CSS keys off `html:not(.wm-active)`**, which covers no-JS, plain mode, and a failed
boot in one selector. The fallback grid fractions equal the window manager's default percents, so
the handoff is sub-pixel.

There is deliberately **no opacity curtain**: an `opacity: 0` that never clears because a script
threw is a blank page. If anything throws, `wm-active` is never added and the site renders exactly
as the static version always did.

There is deliberately **no plain mode**: a user-facing "turn the window manager off" switch is not
an i3 feature, and leaving its input handlers bound over a scrolling document caused half-started
drags that fought text selection. The stacked layout survives only as the involuntary fallback —
`site.js` sets `data-wm="off"` when `createWm` returns null — never as a mode anyone selects.
`Shift`+`R` resets the layout; the session menu offers lock, log out, and restart.

## 6. Persistence

`localStorage`, all reads and writes wrapped in `try/catch` so Safari private mode degrades to "the
site works, preferences do not persist".

| Key | Default | Meaning |
| --- | --- | --- |
| `j3w1.wm.boot` | `"1"` | Greeter |
| `j3w1.wm.lock` | `"10m"` | Idle lock threshold (`off`, `10m`, `30m`) |
| `j3w1.wm.notify` | `"1"` | dunst toasts |
| `j3w1.wm.session` | — | `"1"` once the visitor has logged in |
| `j3w1.wm.layout` | — | Trees, percents, layouts, floating rects, scratchpad, wallpaper |

The login is a **stored session**, not a per-visit animation. `j3w1.wm.session` survives across
visits, so someone who has logged in once lands on the desktop directly; logging out removes it and
returns to the greeter's login panel without replaying the boot log.

**Never persisted:** computed rects, and killed windows.
**Never in the URL:** layout state. The hash belongs to content routing (`#writing/<slug>`).

Writes are debounced 400ms and flushed on `pagehide`, `beforeunload`, and `visibilitychange`, so a
reload immediately after a change does not silently discard it.

`validate()` reconciles rather than trusts: unknown ids are dropped, live windows missing from the
tree are appended to their default workspace, percents are renormalised, and any duplicate id
anywhere forces a full reset to defaults.

The storage key names are duplicated in the inline `<head>` script, which has to run before the
module loads. `wm-contract.test.js` asserts the two agree.

## 7. The greeter

Two phases in one overlay. The boot log scrolls for roughly five seconds — a Manjaro banner, kernel
lines, and systemd units, driven by elapsed time rather than step count so a backgrounded tab catches
up instantly — and any key or click skips to the end. Then the LightDM panel appears and **waits**.
It never authenticates itself.

Unlike the lock screen, the greeter is interactive, so it is neither `inert` nor `aria-hidden`: it is
a `role="dialog"` with an accessible name and a real focusable button, which receives focus when the
panel appears. It still never touches `<main>` and never traps focus — Tab can leave it, and the page
behind stays readable.

The password field is decoration: a fixed run of bullets filled by a timer. No password value exists
in the source and nothing is checked.

It is skipped entirely for a stored session, a deep link (a shared link must never land on a login
screen), automation, `boot off`, Save-Data, and plain mode. Reduced motion skips the *animation*, not
the login, and the panel appears immediately.

## 8. The desktop and the bar

The wallpaper defaults to flat black and carries a `j3w1-i3` wordmark, drawn as `::after` content on
`#wallpaper` — no image request and no bytes. It sits at `z-index: -1`, which paints above the canvas
but **below block backgrounds**, so `html.wm-active body` has to be transparent or an opaque body
hides the wallpaper and the wordmark with it. `html` keeps the black.

Only the 400-weight JetBrains Mono face is self-hosted, so the wordmark's `font-weight: 700` is
synthesised by the browser — the right trade at display size against shipping a second
multi-megabyte font file.

`wiki` and `j3w1ctl` live in the file manager's Places and Network sections rather than the i3bar
tray: they are destinations, not readings the bar reports, and every control in the tray costs the
status blocks room. Moving them recovered 175px, which is what lets `net`, `cpu` and `mem` survive
down to 1280px. Both are also reachable from the launcher (`open wiki`, `exec j3w1ctl`) so closing
the file manager cannot strand them.

## 9. Dragging

A tiled or fullscreen window is far too large to steer by its title bar, so the drag carries a
**proxy**: at most half the workspace and 760×540, which is the size the window will actually become
once it floats. The grab point keeps its relative position, so the cursor stays where it was on the
title bar rather than jumping to a corner. The proxy rect is what gets committed on release, so a
fullscreen window drops at a manageable size instead of covering the screen.

Selection is switched off on title bars, tab strips, grips and window marks *before* the pointer goes
down. Disabling it once a drag commits still lets the first few pixels highlight the title, which
instantly reads as a web page rather than a window manager.

## 10. Honesty in the status bar

A block whose source does not exist is **not rendered at all** — no placeholder, no `n/a`, no
invented value. The bar being visibly shorter in Firefox than in Chromium is correct.

Deliberately not implemented, because no honest browser source exists: volume, disk usage, CPU load,
temperature, network SSID, and system uptime. (`navigator.storage.estimate()` reports an origin
quota, not a disk; labelling it `disk` would be a fabrication.) A desktop's
`{ level: 1, charging: true }` battery is suppressed specifically because it *looks* fabricated.

The same rule governs `neofetch` (`unknown`, never a guess) and `htop` (real frame timing and heap,
no synthesised CPU percentages).

## 11. Cache busting

Every module under `assets/js/wm/` shares **one** `?v=` token, bumped as a unit — pinning only
`boot.js` would let a stale cached `layout.js` load against a fresh `tree.js`.
`wm-contract.test.js` enforces this.

Files outside the tree keep their own tokens and are bumped only when they change:
`content-renderer.js`, `photo-viewer.js`, and `admin/j3w1ctl.js`. The j3w1ctl token in `site.js`
**must** equal the one in `admin/index.html`; `security-static.test.js` asserts it.
