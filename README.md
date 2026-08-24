# j3w1.github.io

Personal site for 申杰 / j3w1, presented as a responsive reinterpretation of the historical Manjaro i3 workstation preserved in [`j3w1/1w3j`](https://github.com/j3w1/1w3j).

The public site is a dependency-free GitHub Pages project: semantic HTML, CSS, modest vanilla JavaScript, and no runtime build step. Its seven workspaces are deep-linked at `#home`, `#writing`, `#projects`, `#photography`, `#books`, `#elsewhere`, and `#about`; published entries add `#writing/<slug>`, `#photography/<slug>`, and `#books/<slug>`.

Writing, reading notes, and photography are Git-managed. Authoritative Markdown lives in [`content/`](content/README.md), the deterministic restricted-AST artifact is `assets/data/content-index.json`, and the safe DOM renderer is shared by the public workspaces and j3w1ctl preview.

## Local preview

From the repository root:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000/#home>.

## Keyboard

- `1`–`7`: switch workspaces
- `h` / `j` / `k` / `l`: move pane focus
- `/` or `:`: open the command launcher
- `?`: show keyboard help
- `Escape`: close an overlay

JetBrains Mono is self-hosted under `assets/fonts/`; its OFL license is included alongside the font.

## Content management

Content can be added manually with the documented templates and CLI, or through the static `/admin/` j3w1ctl client after its service URL is configured. The small Node 24 service under [`services/j3w1ctl-auth/`](services/j3w1ctl-auth/README.md) owns authentication, validation, preview, and atomic expected-head GitHub commits. GitHub is the published-content database; the backend is not content storage.

No production service, GitHub App, credential, branch rule, or deployment is created by this repository.
