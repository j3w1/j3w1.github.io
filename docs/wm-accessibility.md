# Accessibility contract

The rules the window manager must obey. Items marked **enforced** are asserted by
`services/j3w1ctl-auth/test/wm-contract.test.js` or the browser suite; the rest are review
obligations.

A tiling window manager is an unusually easy thing to make inaccessible: it hides content behind
keybindings, decouples visual order from document order, and moves focus constantly. Each rule below
exists because of a specific way that goes wrong.

---

## 1. Nothing is ever removed from the DOM — **enforced**

`kill`, the scratchpad, workspace switching, and tab switching all hide via the `hidden` attribute or
a class. Authored windows are never `remove()`d and killed state is never persisted, so a reload
always restores a complete desktop. Deep-linked content stays reachable and indexable at all times.

## 2. Every window is reachable with `Tab` alone — **enforced**

Each window keeps `tabindex="0"`. Someone who knows nothing about i3, and never presses a shortcut,
must be able to reach every piece of content.

## 3. Document order equals visual order

Therefore `order`, `flex-direction: *-reverse`, and `grid-auto-flow: dense` are **banned in tiling
layouts**: a `split v` that visually puts B above A must reorder the DOM nodes, not paint them out
of sequence. Floating is exempt — it moves windows with absolute positioning and leaves document
order intact.

**Positive `tabindex` is banned everywhere** — **enforced**. It reorders the whole document's tab
sequence, not just the part you were thinking about.

## 4. Focus is never trapped outside `<dialog>`

`#keyboard-help` and `#photo-viewer` use native `showModal()` and may trap. Nothing else may. The
lock screen, toasts, and wallpaper are `inert` — trap-proof by construction rather than by careful
coding. The command launcher is non-modal and `Escape` restores focus.

**The greeter is the deliberate exception to `inert`** — **enforced**. It waits for a real login, so
it must be operable: it is a `role="dialog"` with an accessible name and a focusable button that
takes focus when the panel appears. It does *not* trap focus, `<main>` is never marked hidden, and
the page behind it stays fully readable to a screen reader, and a deep link never reaches it.

## 5. Focus is never lost

**The single most damaging and least visible failure available to this project.** If focus falls to
`<body>`, a screen reader resets its virtual cursor to the top of the document and the reader loses
their place entirely.

Any operation that hides the focused element must first move focus, in this order:

1. the next live window in the workspace,
2. the workspace `<section>` (which carries `tabindex="-1"`),
3. `#main-content`.

Never `<body>`. This applies to kill, workspace switch, tab switch, float, fullscreen, scratchpad,
and the plain-mode toggle. `a11y.js` implements the chain; the browser suite asserts it after a kill.

## 6. One live region in the chrome — **enforced**

`#workspace-announcer` is the only `aria-live` region outside content. `#dunst`, `#greeter`,
`#lockscreen`, `#wallpaper`, and `#i3status` are all silent.

`#i3status` is deliberately **not** a live region: it would announce the clock every second.

Toasts render at the **top right, 25px below the title-bar row** — dunstrc's `geometry "0x4-25+25"`,
shifted down by one title bar. The top-right corner itself belongs to the focused window's minimize,
maximize and close buttons, and a toast landing there after every action blocked exactly the
controls that action was aimed at; the browser suite asserts the stack starts below them.

Toasts and announcements are complements, not duplicates, and are written for different audiences:

| Event | Announcer (screen reader) | dunst (visual) |
| --- | --- | --- |
| workspace switch | "writing workspace active" | `workspace 2:writing` |
| kill | "reader closed. 1 window remains." | `kill reader` |
| mode | "resize mode" | `mode resize` |

Announcements are debounced to one per 150ms, last-wins, so holding `j` does not produce a queue.
Focus movement never produces a toast — that would be a waterfall.

## 7. Tabbed containers are real tab lists — **enforced**

When, and only when, a `tabbed` or `stacked` container exists, its strip is a `role="tablist"` of
`role="tab"` buttons with `aria-selected` and `aria-controls`, and the visible child gets
`role="tabpanel"` with `aria-labelledby`. Arrow keys, `Home`, and `End` move between tabs, with a
roving `tabindex` so the strip is one tab stop.

This replaced an earlier bug: the old mobile buffer tabs applied `role="tabpanel"` at *every*
viewport, including desktop where all panes were simultaneously visible — telling screen readers
something that was not true. Tab semantics now exist only where a tabbed container actually does.

## 8. Reduced motion

With `prefers-reduced-motion: reduce`: no boot animation (the login panel appears immediately), no
idle lock, no workspace slide, no drag inertia, no window animation, no toast slide, no haptics, and
a static `cmatrix`. Reduced motion suppresses the *animation*, not the login itself — those are
different things, and skipping the login would quietly change what the visitor is looking at.

**No behaviour may be sequenced on `transitionend`** — the global reduced-motion block forces a
0.01ms duration and such handlers stop firing reliably. All sequencing is driven by timers or
`requestAnimationFrame`.

`prefers-reduced-motion` does **not** force plain mode. Disliking animation and wanting a different
layout are independent choices.

## 9. Contrast floor

Measured against `--terminal: #0c0909`:

| Token | Ratio | Use |
| --- | --- | --- |
| `--muted` | 5.81:1 | passes — the darkest colour permitted for new chrome text |
| `--quiet` | 4.45:1 | decorative glyphs only |
| `--inactive` | 1.85:1 | **never** for text |

Known outstanding issue: `--inactive` is used by the pre-existing `.content-number` and
`.prose-line::before` rules. Raising it toward `#a8403a` would fix that, but it is a palette change
and out of scope for this work.

### The Xresources palette, and where it is not followed

`site.css` carries the original machine's sixteen colours as `--color0`…`--color15`. The i3bar and
client colours follow the original config **except** where the config's text colour fails the floor
against its own background — computed against `#0C0909`, `color1` is 3.42:1, `color4` 2.09:1,
`color8` 1.86:1, `color12` 2.12:1:

| i3 class | Config | Applied | Why |
| --- | --- | --- | --- |
| `binding_mode` | text fg on `color1` (2.5:1) | text `color0` on `color7`, `color1` underline | text floor |
| `focused_workspace` | text bg on `color1` (3.4:1) | `--selection` with `--prose` (unchanged) | text floor |
| `client.focused` | border `color14`, child border `color4` | border `color4`, title underline `color14` | borders, no text |
| `urgent_workspace` | `color0` on fg | as configured | 8.65:1 |
| dunst `urgency_low` | `color0` on `color15` (4.45:1) | `#000` on `color15` | just under the floor |
| dunst `urgency_critical` | `#F9FAF9` on `#DC282E` | as configured | 4.58:1 |

## 10. Banned outright — **enforced**

- `role="application"` — swallows the screen reader's virtual cursor.
- `aria-modal` outside `<dialog>`.
- `role="grid"` on tiling containers.

Windows stay `<article>` elements with an `aria-label`.

## 11. The session menu, and the removed escape hatch

An earlier version shipped a user-facing plain mode behind an **i3 / plain** toggle. It has been
removed: it is not an i3 feature, and it was a genuine source of bugs, since leaving the pointer and
key handlers bound over a scrolling document produced half-started drags that fought ordinary text
selection.

What replaces it, and what remains:

- The tray button now opens an **i3-nagbar session menu** (`Shift`+`E`): Lock screen, Log out,
  Restart i3 in place. It is a labelled `role="dialog"`, closes on `Escape`, and returns focus to the
  button it came from.
- **The stacked fallback still exists**, but only involuntarily: no JavaScript, or `createWm`
  returning null, sets `data-wm="off"` and renders all seven workspaces as one scrolling document.
  Content therefore remains reachable without the window manager — that guarantee is unchanged.
- Every window is still reachable with `Tab` alone (§2), so no visitor depends on the removed toggle
  to read anything.

*Recorded trade-off:* someone who finds a tiling window manager hard to use no longer has a
one-click way out. The keyboard-reachability, focus, live-region and reduced-motion guarantees below
are what carry that weight now.

## 12. Gesture parity

Every pointer-only capability has a keyboard equivalent:

| Pointer | Keyboard |
| --- | --- |
| gutter drag | `r` resize mode |
| title-bar drag | `Alt`+`Shift`+`Space`, then `H J K L` |
| floating grips | `r` resize mode |
| long-press to float | `Alt`+`Shift`+`Space` or the launcher's `floating toggle` |
| tab click | arrow keys within the tab strip, or `h`/`l` |
| clicking **Log In** | `Enter` on the login panel |
| dismissing a toast | they expire on their own; `notify off` silences them |

A gesture-only capability is an inaccessible capability.

---

## Manual checks before release

Automated tests cover structure; these cover experience:

- NVDA + Firefox and VoiceOver + iOS Safari: switch workspaces, kill a window, switch a tab, float a
  window — confirm focus and announcements at each step.
- Keyboard only, no mouse: reach every workspace and every window.
- 200% browser zoom at 1280px.
- `prefers-reduced-motion` enabled: confirm no greeter and no idle lock.
- JavaScript disabled: confirm every workspace is readable and stacked.
- Force a boot failure (block `assets/js/wm/boot.js`): confirm the same stacked fallback.
