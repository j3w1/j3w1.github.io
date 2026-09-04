# How to use this site

This page is a working [i3](https://i3wm.org/) window manager, rebuilt in a browser. The windows
really tile, split, float, and close; the terminal really runs commands; the status bar really reads
your machine. Everything on it is genuine site content — the workstation is the interface, not a
screenshot of one.

You do not need to know anything about i3 to read it.

---

## If you just want to read

Three ways, in order of least effort:

1. **Click the workspace names** in the top bar — `1:home`, `2:writing`, `3:projects`,
   `4:photography`, `5:books`, `6:elsewhere`, `7:about`.
2. **Press `1`–`7`** to jump straight to one.
3. **Press `/`** to open the launcher and type what you want (`open about`, `open projects`).

On a phone, swipe left and right to move between workspaces, and tap the tabs at the top of a
workspace to switch windows.

**Prefer an ordinary scrolling page?** Click the **i3 / plain** button in the top-right of the bar,
or add `?plain=1` to the address. That gives you every workspace stacked in one plain document, with
no window manager, no animation, and no keyboard capture. The choice is remembered.

---

## Recommended things to try

Worth five minutes if you have never used a tiling window manager:

| Do this | What happens |
| --- | --- |
| Press `?` | The full key map, generated from the live keybindings |
| Press `/`, type `exec neofetch` | Opens neofetch — the Manjaro screenshot classic, filled with your own machine's details |
| In the terminal, type `ls`, then `cd writing`, then `cat <name>` | The site's content, browsed as a filesystem |
| Press `w`, then `e` | Tabs the workspace's windows together, then untiles them again |
| Hold `Alt` and drag a window | Floats it and moves it, like `$mod`+drag in i3 |
| Drag the thin gap between two tiles | Resizes them, like i3's mouse resize |
| Press `f` | Fullscreens the focused window — the nicest way to read a long entry |
| Press `q`, then `Shift`+`R` | Closes a window, then restores the entire desktop |

**Nothing here can be broken permanently.** Closed windows are only hidden, never deleted, and
reloading the page always restores the full desktop. If a layout ever looks wrong, press
`Shift`+`R`.

---

## Keyboard

Bare keys work on their own; `Alt`+*key* does the same thing where your browser allows it. Shortcuts
pause automatically while you are typing in a text field.

### Moving around

| Key | Action |
| --- | --- |
| `1`–`7` | Switch workspace |
| `h` `j` `k` `l` or arrows | Focus the window left / down / up / right |
| `Tab` | Ordinary browser focus — every window is reachable this way |
| `Enter` | Activate the selected row or link |
| `/` or `:` | Open the launcher (dmenu) |
| `?` | Show the key map |
| `Escape` | Leave fullscreen, or close an overlay |

### Arranging windows

| Key | Action |
| --- | --- |
| `H` `J` `K` `L` | Move the focused window |
| `b` / `v` | Split horizontally / vertically |
| `w` / `s` / `e` | Tabbed layout / stacked layout / toggle split |
| `f` | Fullscreen |
| `q` | Close the window (it can always come back) |
| `r` | Resize mode — then `h j k l`, `Shift` for bigger steps, `Escape` to leave |
| `Alt`+`Shift`+`1`–`7` | Move the window to another workspace |
| `Alt`+`Space` | Switch focus between tiled and floating windows |
| `Alt`+`Shift`+`Space` | Float or unfloat the focused window |
| `-` / `_` | Show the scratchpad / send a window to it |
| `Alt`+`Enter` | Open a new terminal |
| `Shift`+`R` | Restart in place: default layout, every window back |

`Space` is only bound with `Alt` on purpose — binding it bare would break using the space bar to
scroll.

---

## Touch

| Gesture | Action |
| --- | --- |
| Swipe left / right | Previous / next workspace |
| Tap a tab | Switch window |
| Long-press a title bar | Float the window, then drag it |

Each workspace uses i3's **tabbed** layout on a phone, which is the same thing i3 does when a screen
is too narrow to tile usefully. Tiling, gutter-dragging, and the scratchpad are switched off below
768px; everything else works. Swiping never overrides scrolling — if a table or a code block can
still scroll sideways, it gets the gesture first.

---

## The terminal

The `1:home` terminal is a real shell. `Tab` completes, `↑`/`↓` walk the history, `Ctrl`+`C` clears
the line.

| Command | Does |
| --- | --- |
| `ls`, `cd`, `pwd`, `tree` | Move around the site as a filesystem |
| `cat <file>` | Read an entry, a project, or a page |
| `open <name>` | Jump to a workspace, an entry, or an external link |
| `help`, `man i3` | The tour above |
| `neofetch`, `htop`, `cmatrix`, `feh` | Launch an application |
| `i3-msg <command>` | Run a window manager command (`i3-msg layout tabbed`) |
| `clear`, `whoami`, `date`, `echo`, `exit` | The usual |

---

## Applications

Launch any of these from the launcher (`/` then `exec <name>`) or from the terminal:

- **neofetch** — system information, read from your own browser.
- **htop** — the open windows as processes, with real frame timing and heap figures.
- **feh** — pick between three wallpapers, drawn in CSS. Remembered.
- **cmatrix** — a toy. Static if you have reduced motion enabled.
- **urxvt** — another terminal (`Alt`+`Enter`).

---

## Settings

All of these are launcher commands, and all are remembered in your browser only:

| Command | Effect |
| --- | --- |
| `exit i3 (plain page)` | Plain scrolling document. Same as the **i3 / plain** button. |
| `boot off` / `boot on` | Skip or restore the login and boot sequence |
| `exec lightdm` | Replay the boot sequence now |
| `lock off` / `lock 10m` / `lock 30m` | Idle screen lock — off, or after 10 or 30 minutes |
| `exec i3lock` | Lock the screen immediately |
| `notify off` / `notify on` | Silence the corner toasts |
| `wallpaper ember` / `carbon` / `ridge` | Change the wallpaper |
| `restart i3 inplace` | Reset the layout to defaults |

### The boot sequence

On your first visit in a browser session you get a LightDM login screen and a short boot log. The
username and password are already filled in — press `Enter` or click **Log In**, or just wait: it
logs itself in after about two seconds. Any key, click, or scroll skips it, and the key you press
still does its normal job.

It never appears when you follow a link straight to an entry, when you have reduced motion enabled,
on a slow or data-saving connection, or more than once per browser session.

### The idle lock

The screen locks after ten minutes of inactivity, showing a clock. Any key or click dismisses it —
there is no password. It never arms on a phone or tablet, never while you are typing or a dialog is
open, and never while the tab is in the background. Turn it off entirely with `lock off`.

---

## Privacy

The status bar and neofetch read your CPU thread count, memory, connection type, battery, screen
size, language, and time zone **from your own browser**. None of it is transmitted, stored, or
logged anywhere — this site has no analytics and no backend for the public page.

Where your browser does not expose something, the value is simply **absent** rather than guessed.
That is why the bar is shorter in Firefox than in Chrome, and why a desktop shows no battery.

Your layout choices, wallpaper, and settings are saved in your browser's local storage and never
leave your machine.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The layout looks wrong | Press `Shift`+`R`, or run `restart i3 inplace` |
| A window disappeared | Press `Shift`+`R`, or click **restore this workspace** |
| Keys do nothing | Your focus is in a text field — press `Escape` or click elsewhere |
| I want a normal web page | Click **i3 / plain**, or use `?plain=1` |
| Nothing loads at all | The site works without JavaScript: every workspace renders as a plain stacked document |

---

## Accessibility

- Every window is reachable with `Tab` alone; no keybinding is required to read anything.
- Tabbed windows are real ARIA tab lists with arrow-key support.
- Workspace, mode, and window changes are announced to screen readers in plain language.
- Focus is never trapped outside a dialog, and never dropped onto the page body.
- With `prefers-reduced-motion` enabled there is no boot sequence, no idle lock, no sliding, and no
  animation of any kind.
- The **i3 / plain** button is always in the tab order, near the start of the page.

See [wm-accessibility.md](wm-accessibility.md) for the full contract.
