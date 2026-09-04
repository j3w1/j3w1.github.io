# Working on the window manager

## Run the site

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000/#home>. There is no build step: GitHub Pages serves these files
verbatim, so what you see locally is what ships.

Useful URLs while developing:

| URL | What it does |
| --- | --- |
| `/#home` | Normal |
| `/?wm=selftest#home` | Runs the pure layout assertions and logs pass/fail to the console |
| `/#home` with JavaScript disabled | The stacked fallback used when the window manager cannot run |

## Run the tests

```powershell
npm --prefix services/j3w1ctl-auth ci            # once
npm --prefix services/j3w1ctl-auth test          # node: 96 tests
npm --prefix services/j3w1ctl-auth run test:browser   # playwright: 20 tests
```

| Suite | Covers |
| --- | --- |
| `test/wm-tree.test.js` | The pure tree and rect maths — every direction × layout combination, seam-free tiling, focus bookkeeping, `validate` reconciliation |
| `test/wm-contract.test.js` | Structure and accessibility invariants asserted against the source |
| `test/security-static.test.js` | Pre-existing: credentials, the project table columns, the j3w1ctl cache key |
| `test/browser/wm.spec.js` | The real thing in a browser: tiling geometry, keys, tabs, drag, shell, plain mode, mobile |

The tree and layout modules are pure and DOM-free specifically so they can be tested in node without
a browser or a DOM shim. Keep them that way.

## Adding a keybinding

Add an entry to the `bindings` array in `wm/keys.js`:

```js
{ keys: "g", description: "do the thing", test: (event) => event.key === "g", run: () => wm.doTheThing() }
```

The help dialog and `docs/wm-usage.md`'s key table are generated from `wm.bindings()`, so they cannot
drift. Add a matching launcher command in `boot.js`'s `commands()` so the action is reachable without
a keyboard — see the gesture-parity rule in [wm-accessibility.md](wm-accessibility.md).

Before choosing a key: bare letters are the primary scheme, `Alt`+letter is an accepted alias.
`Alt`+arrow is browser history and must stay unbound. Bare `Space` must stay unbound or space-to-
scroll breaks inside terminal buffers and readers.

## Adding an application

1. Write `wm/apps/<name>.js` exporting a factory that takes `{ body, statusline, title, wm, close }`
   and returns `{ destroy(), focus?() }`.
2. Register it in `wm/apps/index.js` with a title, a window class, and status line labels.

It is then automatically launchable from the launcher (`exec <name>`) and the shell.

Two rules for application output:

- **Write text with `textContent`, never `innerHTML`.** Markdown bodies go through the existing
  restricted-AST renderer (`renderAst` from `content-renderer.js`), which is the only sanctioned path
  from content to DOM.
- **Never invent a value.** If the browser does not expose something, print `unknown` or omit the row.
  See §7 of [wm-architecture.md](wm-architecture.md).

## Adding or moving a window

Authored windows are declared in `index.html` and listed in `wm/defaults.js`. Both must agree —
`wm-contract.test.js` fails otherwise. A window needs:

```html
<article class="window pane <app-class>"
         data-wm-window="<id>" data-wm-title="<tab label>"
         tabindex="0" aria-label="<accessible name>">
```

Never create, move, clone, or remove an authored window at runtime. See §1 of
[wm-architecture.md](wm-architecture.md) for why.

## Changing geometry

Sizes that vary by viewport live in CSS custom properties (`--gap`, `--wm-tab-height`,
`--wm-stack-row`) and are read by the renderer, so the stylesheet stays the single source of truth.
Do not hard-code a pixel size in `layout.js` that a breakpoint needs to change.

## Cache busting

Every module under `assets/js/wm/` shares one `?v=` token, bumped as a unit:

```powershell
# from the repo root, replacing the date
(Get-ChildItem -Recurse assets/js/wm -Filter *.js) + (Get-Item index.html, assets/js/site.js) |
  ForEach-Object { (Get-Content $_ -Raw) -replace '\?v=20260904', '?v=YYYYMMDD' | Set-Content $_ }
```

Then bump `site.css`, `desktop.css`, `site.js`, and `public-content.js` in `index.html`.
**Do not** bump `content-renderer.js`, `photo-viewer.js`, or `admin/j3w1ctl.js` unless they changed —
the j3w1ctl token in `site.js` must keep matching `admin/index.html`.

## The wiki

**The public wiki is `wiki/index.html`, served at <https://j3w1.github.io/wiki/>.** It is a hand-
authored page rather than a generated one, styled from `site.css` plus a small inline `<style>` block
so it cannot affect the desktop's stylesheet budget.

It is deliberately part of the site rather than a GitHub wiki: GitHub only creates a repository's
wiki git remote after the first page is made in the web UI and there is no API for that first page,
so a GitHub wiki could never be created or kept current from here.

The site points at it from five places, all asserted by `wm-contract.test.js`:

- the file manager's *Places → Wiki* entry (the i3bar tray is for status, not destinations),
- the `?` help dialog,
- the `6:elsewhere` link list,
- the empty-workspace hint,
- the launcher (`open wiki`) and the shell (`wiki`).

When you change a keybinding, update `wiki/index.html` too — the contract test checks that the keys
it documents still exist in `keys.js`, but it cannot check that new ones were added.

### Optional: mirroring to a GitHub wiki

If you ever enable one, create the first page at <https://github.com/j3w1/j3w1.github.io/wiki>, then:

```powershell
git clone https://github.com/j3w1/j3w1.github.io.wiki.git ../j3w1.wiki
Copy-Item docs/wm-usage.md          ../j3w1.wiki/Home.md
Copy-Item docs/wm-architecture.md   ../j3w1.wiki/Architecture.md
Copy-Item docs/wm-accessibility.md  ../j3w1.wiki/Accessibility.md
Copy-Item docs/wm-development.md    ../j3w1.wiki/Development.md
cd ../j3w1.wiki
git add -A && git commit -m "docs: publish window manager documentation" && git push
```

## Debugging

- `?wm=selftest` — layout assertions in the console.
- `localStorage.removeItem("j3w1.wm.layout")` — forget the saved layout.
- `Shift`+`R` — restart in place.
- If the desktop does not appear at all, check the console: `createWm` is wrapped in `try/catch`, so
  a throw leaves `html.wm-active` unset and the site silently renders as the static fallback. That is
  intentional, but it does mean a boot error looks like "the window manager just didn't load".

## Things that will bite you

- **The browser fixture serves its own content index.** Photography slugs in browser tests are
  `fixture-photographs`, not the published ones.
- **Flex trims leading whitespace in flex items.** The shell prompt wraps its spans in a
  `.shell-prompt` element for exactly this reason.
- **`[hidden]` is `display: none !important` in `site.css`.** You cannot override it with a
  `display` rule; do not set `hidden` on something you intend to show with CSS.
- **`.no-js` and `html:not(.wm-active)` are different things.** The first means "no JavaScript"; the
  second also covers plain mode and a failed boot, and is the one most fallback rules should use.
