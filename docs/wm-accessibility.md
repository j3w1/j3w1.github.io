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
greeter, lock screen, toasts, and wallpaper are `inert` — trap-proof by construction rather than by
careful coding. The command launcher is non-modal and `Escape` restores focus.

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

With `prefers-reduced-motion: reduce`: no greeter, no idle lock, no workspace slide, no drag
inertia, no window animation, no toast slide, no haptics, and a static `cmatrix`.

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

## 10. Banned outright — **enforced**

- `role="application"` — swallows the screen reader's virtual cursor.
- `aria-modal` outside `<dialog>`.
- `role="grid"` on tiling containers.

Windows stay `<article>` elements with an `aria-label`.

## 11. The escape hatch

A permanently visible `<button id="wm-toggle">` sits in the bar tray with `aria-pressed`, labelled
**i3** / **plain**, reachable within roughly ten tab stops. *An escape hatch you have to discover via
a keyboard shortcut is not an escape hatch.* It is also exposed as `?plain=1`, as the launcher
command `exit i3`, and in the help dialog.

The preference is read synchronously in the `<head>` so there is no flash of window manager, and
toggling does not reload: it sets the attribute, re-runs layout, announces the change, and returns
focus to the button.

Plain mode stacks all seven workspaces in one scrolling document with no greeter, lock, toasts,
gestures, or bare-key bindings except `?`.

## 12. Gesture parity

Every pointer-only capability has a keyboard equivalent:

| Pointer | Keyboard |
| --- | --- |
| gutter drag | `r` resize mode |
| title-bar drag | `Alt`+`Shift`+`Space`, then `H J K L` |
| floating grips | `r` resize mode |
| long-press to float | `Alt`+`Shift`+`Space` or the launcher's `floating toggle` |
| tab click | arrow keys within the tab strip, or `h`/`l` |

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
- `?plain=1`: confirm the same.
