# How to use this site

> 📖 **The formatted version of this guide lives at <https://j3w1.github.io/wiki/>**, and is reachable
> from the site itself: the file manager's *Places → Wiki* entry on `1:home`, the `?` help dialog,
> `6:elsewhere`, the launcher's `open wiki`, or `wiki` in the terminal.

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

If JavaScript is off, or anything fails to load, the whole site renders instead as one ordinary
stacked page — every workspace readable, top to bottom.

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
| `1`–`7` | Switch workspace — the same number again goes back to the previous one |
| `` ` `` | Workspace back and forth |
| `Ctrl`+`←` / `→` | Previous / next workspace |
| `h` `j` `k` `l` or arrows | Focus the window left / down / up / right |
| `a` | Focus the parent container |
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
| `q` or `Shift`+`Q` | Close the window (it can always come back) |
| `r` | Resize mode — then `h j k l`, `Shift` for bigger steps, `Escape` to leave |
| `Shift`+`G` | Gaps mode — `i` inner or `o` outer, then `+` / `-` / `0`, `Escape` to leave |
| `u` / `y` / `n` | Border none / one pixel / normal title bar, for the focused window |
| `Shift`+`S` | Sticky: keep a floating window on every workspace |
| `m` | Hide the bar; it returns on hover at the top edge or when focus enters it |
| `Alt`+`Shift`+`1`–`7` | Move the window to another workspace and follow it |
| `Ctrl`+`Alt`+`1`–`7` | Move the window to another workspace and stay |
| `~` | Move the window to the previous workspace and follow it |
| `Alt`+`Space` | Switch focus between tiled and floating windows |
| `Alt`+`Shift`+`Space` | Float or unfloat the focused window |
| `-` / `_` | Show the scratchpad / send a window to it |
| `Alt`+`Enter` | Open a new terminal |
| `Shift`+`R` | Restart in place: default layout, every window back |
| `Shift`+`C` | Reload the configuration: gaps, bar and labels re-applied |
| `Shift`+`E` | Session menu (i3-nagbar): lock, log out, restart i3, suspend, reboot, shut down |
| `0` | System mode, as the original config bound it: `l`ock, `e`xit, switch `u`ser, `s`uspend, `h`ibernate, `r`eboot, `Shift`+`S` shutdown |
| `Ctrl`+`Space` | Close every notification |

`Space` is only bound with `Alt` on purpose — binding it bare would break using the space bar to
scroll.

---

## Touch

| Gesture | Action |
| --- | --- |
| Swipe left / right | Previous / next workspace |
| Tap a tab | Switch window |
| Long-press a title bar | Float the window, then drag it |

Each workspace starts in i3's **tabbed** layout on a phone, which is the same thing i3 does when a
screen is too narrow to tile usefully; every command still works, and the gutter grab area grows to
16px for fingers. Swiping never overrides scrolling — if a table or a code block can still scroll
sideways, it gets the gesture first.

---

## The terminal

The `1:home` terminal is a real shell. `Tab` completes, `↑`/`↓` walk the history, `Ctrl`+`C` clears
the line.

Type `help` for the full list. It is split into two sections on purpose:
**commands you type here** and **keys you press anywhere on the desktop** — the
shortcuts below are not shell commands, and typing `/` or `?` at the prompt will
tell you so rather than silently failing.

| Command | Does |
| --- | --- |
| `ls`, `cd`, `pwd`, `tree` | Move around the site as a filesystem |
| `cat <file>` | Read an entry, a project, or a page |
| `open <name>` | Jump to a workspace, an entry, or an external link |
| `help` | Commands and keys, listed separately |
| `keys` | Just the window manager keyboard shortcuts |
| `dmenu` | Open the command launcher (same as pressing `/`) |
| `neofetch`, `htop`, `cmatrix`, `feh`, `conky` | Launch an application |
| `i3-msg <command>` | Run a window manager command (`i3-msg layout tabbed`; `;` chains) |
| `i3exit <action>`, `reboot`, `poweroff`, `systemctl …` | The session and power actions |
| `journalctl -b` | This boot's log |
| `cat ~/.config/i3/config` | The original machine's dotfiles: i3, i3status, dunst, `.Xresources`, `.dmenurc`, the screen layout |
| `xrandr`, `screenlayout` | The display (real), and the historical three-monitor layout |
| `notify-send <text>` | A dunst notification |
| `uname -a`, `hostname`, `uptime` | The usual, honest about being a session |
| `logout` | End the session and return to the login screen |
| `clear`, `whoami`, `date`, `echo`, `exit` | The usual |

---

## The session menu

The power button at the right of the bar — or `Shift`+`E` — opens an i3-nagbar across the top, the
same way i3 answers `$mod+Shift+E`. The `0` key opens the same actions as a binding mode, exactly as
the original config bound them (`i3exit`), and the terminal takes `i3exit <action>`, `reboot` and
`poweroff`:

| Action | Does |
| --- | --- |
| **Lock screen** (`l`) | i3lock immediately; press any **key** to dismiss it — moving the mouse will not |
| **Log out** (`e`) | Ends the session and returns to the login panel |
| **Switch user** (`u`) | The login panel, with the session and layout kept |
| **Restart i3 in place** | Resets every window and layout to defaults |
| **Suspend** (`s`) | Locks, then the screen goes dark until a key; that key wakes the machine to the lock screen without unlocking it |
| **Hibernate** (`h`) | As suspend, resuming through the kernel's PM lines |
| **Reboot** (`r`) | systemd stops its units, the screen goes black, the machine boots and LightDM waits — about ten seconds. Spawned windows close and the session ends, as on a real reboot; the saved layout survives |
| **Shut down** (`Shift`+`S`) | The shutdown log, then a halted screen with a power button; any key powers the machine on |

`Escape` or **Cancel** closes the menu without doing anything. Under reduced motion every sequence
still changes state — it just lands there at once.

---

## Applications

Launch any of these from the launcher (`/` then `exec <name>`) or from the terminal:

- **conky** — the original config's panel at the top right: the date in Chinese, CPU threads, the
  open windows as processes, device memory and the JavaScript heap, uptime. Floating, sticky and
  borderless, as its config file said.
- **neofetch** — system information, read from your own browser.
- **htop** — the open windows as processes, with real frame timing and heap figures.
- **feh** — pick between three wallpapers, drawn in CSS. Black is the default and carries the
  `j3w1-i3` wordmark. Remembered.
- **cmatrix** — a toy. Static if you have reduced motion enabled.
- **urxvt** — another terminal (`Alt`+`Enter`).

---

## Settings

All of these are launcher commands, and all are remembered in your browser only:

| Command | Effect |
| --- | --- |
| `log out` | End the session; the login screen returns |
| `boot off` / `boot on` | Skip or restore the login and boot sequence |
| `exec lightdm` | Replay the boot sequence now |
| `lock off` / `lock 10m` / `lock 30m` | Idle screen lock — off, or after 10 or 30 minutes |
| `exec i3lock` | Lock the screen immediately |
| `notify off` / `notify on` | Silence the corner toasts |
| `wallpaper black` / `ember` / `ridge` | Change the wallpaper (black is the default) |
| `restart` | Reset the layout to defaults |
| `gaps inner set 14` / `gaps outer set -2` | i3-gaps — 14 / −2 are the defaults, and a lone window gets none (smart gaps) |
| `bar mode hide` / `bar mode dock` | Hide the bar until hovered or focused, or keep it docked |
| `bar labels zh` / `bar labels en` | The status bar's labels — Chinese, as the original i3status.conf had them (the default), or English |
| `border none` / `border pixel 1` / `border normal` | The focused window's border and title bar |
| `i3-msg …` | Every launcher entry is an i3 command; `workspace 2; layout tabbed` chains with `;` |

### Booting and logging in

The first time you arrive, the machine boots: a Manjaro banner, kernel lines, and systemd units
coming up, taking about five seconds. Any key or click skips straight to the end.

Then the **LightDM login screen** appears and waits for you. The username and password are already
filled in — the password is decorative bullets, and no password value exists anywhere in the page.
Press `Enter`, or click **Log In**. Nothing else logs you in: a click on the desktop behind the
panel is ignored.

**Logging in is remembered.** Come back tomorrow and the desktop appears immediately, with no boot
and no login, until you log out.

| To | Do |
| --- | --- |
| Log out | `Shift`+`E` then **Log out**, the launcher's `log out`, or type `logout` |
| Log back in | The login panel is already there — press `Enter` |
| Watch the boot again | The launcher's `exec lightdm` |
| Never see it again | The launcher's `boot off` |

Logging out returns you to the login panel without replaying the boot log, exactly as leaving a real
X session does.

The boot and login never appear when you follow a link straight to an entry — a shared link must
never land someone on a login screen — nor on a slow or data-saving connection, nor when the
launcher's `boot off` has been used. With reduced motion enabled the boot animation is skipped and
the login panel appears immediately.

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
| A shortcut does nothing in the terminal | Desktop keys are not shell commands; press them outside the terminal, or type `keys` |
| Stuck on the login screen | Press `Enter` |
| Nothing loads at all | The site works without JavaScript: every workspace renders as a plain stacked document |

---

## Accessibility

- Every window is reachable with `Tab` alone; no keybinding is required to read anything.
- Tabbed windows are real ARIA tab lists with arrow-key support.
- Workspace, mode, and window changes are announced to screen readers in plain language.
- Focus is never trapped outside a dialog, and never dropped onto the page body.
- With `prefers-reduced-motion` enabled there is no boot sequence, no idle lock, no sliding, and no
  animation of any kind.
- The session menu (`Shift`+`E`, or the power button in the bar) gathers lock, log out and restart.
- The login panel is a labelled dialog with a real focusable button; it does not trap focus, and the
  page behind it stays readable to a screen reader throughout.
- Notifications appear at the bottom right, clear of every window's controls, and are never
  announced twice.

See [wm-accessibility.md](wm-accessibility.md) for the full contract.
