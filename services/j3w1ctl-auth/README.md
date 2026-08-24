# j3w1ctl-auth

This Node 24 service is the deliberately narrow write boundary for the static j3w1ctl application. GitHub remains the published-content database; DigitalOcean runs authentication, validation, preview, and one-commit repository mutations only. The service stores no content on its ephemeral filesystem.

## Local setup

Copy `.env.example` into an untracked `.env`, provide a GitHub App created for local testing, then load those variables before `npm start`. `GET /healthz` remains healthy while configuration is incomplete; every authentication or API operation fails closed.

The GitHub App requires only repository `Contents: Read and write`, must be installed only on `j3w1/j3w1.github.io`, and uses one exact callback URL. No PAT, Actions, Workflows, Administration, Issues, or Pull Requests permission is used. The temporary user authorization token is revoked immediately after the configured numeric user ID and normalized login are both verified.

## Content workflow

From the repository root:

```powershell
npm --prefix services/j3w1ctl-auth ci
npm --prefix services/j3w1ctl-auth run content:new -- --repo-root ../.. --collection writing --slug my-entry
npm --prefix services/j3w1ctl-auth run content:validate -- --repo-root ../..
npm --prefix services/j3w1ctl-auth run content:rebuild -- --repo-root ../..
```

Manual editing uses the templates in `content/_templates/`. A Markdown file inside a collection is public; private drafts must stay outside the repository. `content:check` fails when the committed deterministic index is stale. j3w1ctl local drafts and selected WebP blobs live only in that browser's IndexedDB, survive logout, and can be removed with the separately confirmed “Forget local drafts” action.

## Publication safety

The service serializes all mutations. It reads one exact branch head, enforces the caller's blob precondition, rebuilds the entire index in memory, then calls GraphQL `createCommitOnBranch` once with that head as `expectedHeadOid`. Markdown, image pairs, deletions, and the public index therefore land in one commit. A changed head returns a conflict; it is never retried automatically against newer content. Paths are derived server-side from validated collection, immutable slug, and image ID.

Session credentials are 60-minute HS256 JWTs kept by the browser in `sessionStorage`. OAuth state uses a separate HKDF-derived key and a short-lived encrypted HttpOnly cookie. Logout removes the browser token first and revokes its JTI in this process best-effort. Run exactly one App Platform instance because the revocation set is intentionally in memory and the product is single-owner.

## Deployment and activation

The example app spec uses `npm ci`, `npm start`, `/healthz`, `process.env.PORT`, one instance, runtime secrets, and `deploy_on_push: false`. Owner-operated production activation is:

1. Deploy the unconfigured service and record its permanent HTTPS URL.
2. Register the GitHub App with that service's single callback URL and only Contents read/write.
3. Install it only on `j3w1/j3w1.github.io`.
4. Add all values shown in `.env.example` as encrypted runtime variables where secret.
5. Put the service origin in `admin/config.js` (no path, query, credentials, or trailing data).
6. Exercise create, stale-update conflict, photography replacement, and deletion against `cms-sandbox`.
7. Change `GITHUB_BRANCH` to `main` only after those tests pass.

GitHub Pages continues to build from `main` at the repository root. `main` is currently unprotected; before activation, the owner must add a rule that blocks force pushes and branch deletion while allowing ordinary GitHub App fast-forward commits. This repository does not configure that rule.

## Operations

- Rotate the GitHub private key/client secret and `CMS_SESSION_SECRET` together during a maintenance window; existing CMS sessions and OAuth states then become invalid.
- Disable access by suspending/uninstalling the App or removing the App Platform secrets. The public site and committed content remain available.
- Recover content with normal Git history. Rebuild `assets/data/content-index.json` from the authoritative Markdown before publishing a manual correction.
- Logs intentionally exclude headers, query strings, bodies, cookies, and tokens. API failures expose only a stable code, safe message, and request ID.

