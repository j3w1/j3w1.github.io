# j3w1ctl architecture

The public site is a dependency-free GitHub Pages renderer. `content/**` is authoritative, `assets/data/content-index.json` is deterministic public output, and both public pages and j3w1ctl preview consume the same restricted AST renderer. Raw HTML is disabled at compilation and CMS-controlled strings are inserted as text, never as HTML.

`/admin/` and the i3bar launcher run the same static application. The launcher lazy-loads both its script and stylesheet. The application opens a GitHub authorization popup only from the Authenticate button, validates the exact service origin, popup reference, message type, and channel nonce, and stores the returned CMS token in `sessionStorage`. Drafts, including selected photograph blobs, are stored in IndexedDB and are unavailable while locked.

The service exposes no general GitHub proxy. It authenticates its owner, validates one of three schemas, derives every repository path, and performs one expected-head GraphQL commit. Installation tokens are treated as opaque and cached only in memory. Photography accepts no more than twelve explicit full/thumbnail WebP pairs and verifies RIFF/WEBP signatures and size limits.

When a remote version changes, j3w1ctl preserves the local version as a draft, disables publication, and asks the owner to reload remote content or keep the local draft. It never merges automatically. Delete confirmations enumerate the exact server-derived entry and media paths.

