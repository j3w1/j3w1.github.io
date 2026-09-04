# j3w1.github.io

Personal site for 申杰 / j3w1, presented as a working reinterpretation of the historical Manjaro i3
workstation preserved in [`j3w1/1w3j`](https://github.com/j3w1/1w3j).

The page is not a picture of a window manager — it is one. Windows tile, split, float, resize, and
close; the terminal runs commands over the site's own content; the status bar reads the visitor's
own machine. It stays readable on a phone, and renders as one plain stacked document whenever the
window manager cannot run.

The public site is a dependency-free GitHub Pages project: semantic HTML, CSS, vanilla ES modules,
and no runtime build step. Its seven workspaces are deep-linked at `#home`, `#writing`, `#projects`,
`#photography`, `#books`, `#elsewhere`, and `#about`; published entries add `#writing/<slug>`,
`#photography/<slug>`, and `#books/<slug>`.

Writing, reading notes, and photography are Git-managed. Authoritative Markdown lives in
[`content/`](content/README.md), the deterministic restricted-AST artifact is
`assets/data/content-index.json`, and the safe DOM renderer is shared by the public workspaces and
j3w1ctl preview.

## Using the site

**📖 The wiki is at <https://j3w1.github.io/wiki/>** — quick start, key points, every hotkey, the
terminal's commands, touch gestures, session and settings, privacy, and troubleshooting. It is
reachable from the site itself: the **wiki** button in the bar, the `?` help dialog, `6:elsewhere`,
the launcher's `open wiki`, or `wiki` in the terminal. Source: [`wiki/index.html`](wiki/index.html).

The short version:

- `1`–`7` switch workspace, or click the names in the bar. On a phone, swipe.
- `/` opens the launcher — every command is reachable there without a keyboard shortcut.
- `?` shows the keys.
- `Shift`+`E` (or the power button in the bar) opens the session menu: lock, log out, restart i3.

Nothing can be broken permanently: closed windows are only hidden, and reloading always restores the
full desktop.

## Documentation

| Document | For |
| --- | --- |
| [wiki/](https://j3w1.github.io/wiki/) | **Visitors — how to use the site** |
| [wm-usage.md](docs/wm-usage.md) | The same guide in Markdown, for the repository |
| [wm-architecture.md](docs/wm-architecture.md) | How the window manager is built and why |
| [wm-accessibility.md](docs/wm-accessibility.md) | The rules the implementation must obey |
| [wm-development.md](docs/wm-development.md) | Running it, testing it, extending it |
| [j3w1ctl-architecture.md](docs/j3w1ctl-architecture.md) | The content management client and its backend |

## Local preview

From the repository root:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000/#home>.

## Tests

```powershell
npm --prefix services/j3w1ctl-auth ci
npm --prefix services/j3w1ctl-auth test              # 96 node tests
npm --prefix services/j3w1ctl-auth run test:browser  # 20 Playwright tests
```

Opening the site with `?wm=selftest` runs the pure layout assertions in the browser console.

JetBrains Mono is self-hosted under `assets/fonts/`; its OFL license is included alongside the font.

## Asset versioning

Cache busting is manual `?v=` query strings. **Every module under `assets/js/wm/` shares one token
and is bumped as a unit** — pinning only `boot.js` would let a stale cached `layout.js` load against
a fresh `tree.js`. `content-renderer.js`, `photo-viewer.js`, and `admin/j3w1ctl.js` keep their own
tokens and are bumped only when they change; the j3w1ctl token in `assets/js/site.js` must always
equal the one in `admin/index.html`.

## Content management

Content can be added manually with the documented templates and CLI, or through the static `/admin/`
j3w1ctl client after its service URL is configured. The narrow Node 24/Fastify service under
[`services/j3w1ctl-auth/`](services/j3w1ctl-auth/README.md) runs as Vercel Functions and owns
authentication, validation, private temporary image staging, and atomic expected-head GitHub commits.
GitHub is the published-content database; Vercel Blob is staging only and the backend is not
permanent content storage.

In production, the service is source-bound to `j3w1/j3w1.github.io@main`; no browser or deployment
setting can select another publication target. j3w1ctl requires API protocol compatibility before
enabling authentication or mutation. Save draft remains browser-local, Preview does not publish, and
Publish performs one expected-head GitHub mutation with no automatic write retry. Photography sources
may be JPG, JPEG, PNG, or WebP; j3w1ctl creates full and thumbnail WebP files locally, stages only
those generated files in private Blob, and never uploads the original source.

Backend deployment is explicit: protected Preview, staged Production without domain assignment, then
promotion of the exact accepted deployment. Automatic Git deployments are disabled. The previous
DigitalOcean publisher is not a fallback.

## Privacy

The public page has no analytics and no backend. The status bar and `neofetch` read hardware
concurrency, device memory, connection type, battery, screen size, language, and time zone from the
visitor's own browser and transmit none of it. Where a browser does not expose a value it is left
absent rather than guessed. Layout, wallpaper, and preferences are stored in `localStorage` and never
leave the visitor's machine.
