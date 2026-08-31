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

Content can be added manually with the documented templates and CLI, or through the static `/admin/` j3w1ctl client after its service URL is configured. The narrow Node 24/Fastify service under [`services/j3w1ctl-auth/`](services/j3w1ctl-auth/README.md) runs as Vercel Functions and owns authentication, validation, private temporary image staging, and atomic expected-head GitHub commits. GitHub is the published-content database; Vercel Blob is staging only and the backend is not permanent content storage.

In production, the service is source-bound to `j3w1/j3w1.github.io@main`; no browser or deployment setting can select another publication target. j3w1ctl requires API protocol compatibility before enabling authentication or mutation. Save draft remains browser-local, Preview does not publish, and Publish performs one expected-head GitHub mutation with no automatic write retry. Photography sources may be JPG, JPEG, PNG, or WebP; j3w1ctl creates full and thumbnail WebP files locally, stages only those generated files in private Blob, and never uploads the original source.

Backend deployment is explicit: protected Preview, staged Production without domain assignment, then promotion of the exact accepted deployment. Automatic Git deployments are disabled. The previous DigitalOcean publisher is not a fallback.
