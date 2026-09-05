# j3w1ctl-auth

This Node 24/Fastify service is the narrow Vercel publication boundary for the static GitHub Pages j3w1ctl client. Source constants bind it to `j3w1/j3w1.github.io@main`. GitHub is canonical published-content storage; private Vercel Blob holds generated photographs only while a bounded upload batch is open or under investigation.

## Local setup

Copy `.env.example` to an untracked `.env` and use development-only providers and a GitHub App created for local testing. `PORT` and `CMS_DEV_ORIGINS` are development-only. Production ignores `PORT` and does not support `GITHUB_OWNER`, `GITHUB_REPO`, or `GITHUB_BRANCH`. `GET /healthz` remains available when configuration is incomplete; authenticated and provider-backed operations fail closed.

The site-publisher GitHub App requires repository `Contents: Read and write`, is installed only on `j3w1/j3w1.github.io`, and uses exact callback URLs. No PAT or Actions, Workflows, Administration, Issues, Pull Requests, or deployment permission is used. The temporary OAuth token is revoked immediately after both owner ID and normalized login pass.

Run the local graph from the repository root:

```powershell
npm --prefix services/j3w1ctl-auth ci
npm --prefix services/j3w1ctl-auth test
npm --prefix services/j3w1ctl-auth run client:check
npm --prefix services/j3w1ctl-auth run content:check
npm --prefix services/j3w1ctl-auth run deploy:preflight
```

The preflight makes no durable mutation. With no provider credentials it checks source, lock, protocol, fixed-target, secret-scan, link, and cutover invariants and marks credential-dependent checks unavailable. With Production credentials it additionally creates, reads, and removes one disposable Redis TTL key and one private Blob object. `--json` emits strict machine-readable results. Provider setup and acceptance use separately named commands.

## Configuration ownership

| Name | Ownership and scope |
| --- | --- |
| `j3w1/j3w1.github.io@main`, protocol `1` | immutable source constants |
| `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_DEPLOYMENT_ID`, `VERCEL_REGION` | Vercel system values; safe bounded provenance |
| `CMS_SITE_ORIGIN`, `CMS_ALLOWED_GITHUB_LOGIN`, `CMS_ALLOWED_GITHUB_USER_ID`, `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CALLBACK_URL`, `GITHUB_API_VERSION` | Production non-secret configuration; absent or harmless in Preview |
| `CMS_SESSION_SECRET`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY_BASE64`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET` | Production secrets only; absent from Preview |
| `PORT`, `CMS_DEV_ORIGINS` | Development-only |
| `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH` | obsolete and unsupported |

`CMS_SESSION_SECRET` encrypts/authenticates OAuth state; it does not sign browser sessions. Sessions are random 32-byte base64url bearer tokens represented in Redis only as `sess:v1:<sha256(token)>` records with schema, exact owner, issue/expiry time, protocol, and a 3,600-second TTL. Logout deletes the shared record and invalidates every Function instance.

## Content and photography

Save draft and source photographs stay in IndexedDB. Preview validates and renders with zero repository writes. Writing/book publication uses a small JSON request. Photography publication creates a private 30-minute batch, uploads only browser-generated WebP pairs directly to server-derived Blob paths, then finalizes with small JSON. The server checks the exact object set, MIME, full/thumbnail pairing, source size constants, RIFF/WEBP bytes, owner/session, slug/action/preconditions, and current GitHub CAS before a single commit attempt. Success and proven validation/conflict states delete staging. An ambiguous GitHub outcome is held without retry; an authenticated hourly Cron removes only abandoned `staging/j3w1ctl/` objects older than six hours.

All publication paths use one branch snapshot and `expectedHeadOid`. GitHub CAS, not a Function-local mutex, resolves competing instances. Effectful publication is single-attempt. After an ambiguous response, one read-only branch check classifies proven success, proven failure, or hold unknown. No hold produces another write.

## Vercel deployment

The Vercel project is `j3w1ctl-auth`, linked to `j3w1/j3w1.github.io` with Root Directory `services/j3w1ctl-auth`, Node 24, Fastify Functions/Fluid compute, and `git.deploymentEnabled=false`. `vercel.json` schedules the bounded staging cleanup. No Next.js wrapper is used. The CLI runs from the repository root, so the canonical link is the repository-level `.vercel/project.json`; Root Directory is remote project configuration that no local link file records, and the preflight reports it as expected rather than verified.

Provider activation sequence:

1. Configure Production-only secrets and exact `CMS_SITE_ORIGIN=https://j3w1.github.io` and `<production-origin>/auth/github/callback`; keep Preview free of production credentials.
2. Enable Standard Deployment Protection for Preview and generated deployment URLs. Keep the production API origin public.
3. Configure Vercel WAF limits for OAuth start/callback, authenticated reads, and mutation/upload controls. Identity and Origin checks remain application-level.
4. Review team metered spend, then enable low web/email notifications and automatic production pause at a threshold above fixed plan/seat charges and normal low-volume traffic.
5. Build a protected Preview with `vercel deploy`; it must report `configured=false` and remain zero-write.
6. Stage the exact reviewed commit with `vercel --prod --skip-domain` from a proven-clean tree: `git status --porcelain` empty, fetched, and `HEAD` equal to `origin/main` unless a deliberate exception is recorded. The CLI uploads the working tree while the deployment takes its Git metadata from local `HEAD`, so an uncommitted edit makes `/healthz` name a commit whose bytes were never deployed. Record the exact `HEAD` and the staged deployment identifier.
7. Run preflight and provider acceptance against that candidate. Acceptance exercises the local candidate source against the real GitHub provider; it does not exercise the staged Vercel URL, so passing it is evidence about publication semantics and not about the deployment.
8. Read production `/healthz` and record the current `provenance.deploymentId` as the known-good rollback target, promote only the staged deployment with `vercel promote <exact-deployment>`, then read production `/healthz` uncached and require `provenance.sourceRevision` to equal the recorded `HEAD` and `provenance.deploymentId` to equal the promoted deployment. Activation is complete only then; if either differs, `vercel rollback <recorded-deployment>` and verify again.
9. Put the accepted production origin alone in `admin/config.js`, publish through the reviewed repository path, and verify GitHub Pages and the real browser flow. `/healthz` proves deployed identity and the browser flow proves deployed integration; neither substitutes for the other.

Deployment completion is the verified identity of one promoted deployment, not equality with `main`. A later commit that changes no deployed runtime input legitimately leaves the production `sourceRevision` behind `main`, so a promotion is owed when the deployed runtime actually changes and is closed by the activation-time check above, not by a standing comparison.

Provider acceptance requires `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_BASE64`, `GITHUB_API_VERSION`, `--apply`, and separately an authenticated `gh`. The two credentials are not interchangeable: `gh` reads the exact `main` head, creates and deletes the ephemeral branch, and reads every commit back, while the GitHub App private key makes the six single-attempt provider commits that must resolve to one consistent bot identity. `vercel env ls` reports a type per name — `GITHUB_APP_ID` and `GITHUB_API_VERSION` are `Config` values, `GITHUB_PRIVATE_KEY_BASE64` is a `Secret` and reads `Hidden`. Production Functions consume that Secret; the CLI does not return it. `vercel env run -e production` therefore supplies the App ID and API version but never the private key, and `vercel env pull` is not a way round it: it defaults to Development and accepts `--environment`, but the `Secret` type rather than the environment is what withholds the value. `GITHUB_CLIENT_SECRET`, `CMS_SESSION_SECRET`, and `CRON_SECRET` behave the same way.

Supply the key from the separately retained App private key, in memory only. The npm shim consumes `--` under PowerShell, so call the CLI and the script directly:

```powershell
$pem = [IO.File]::ReadAllBytes("<retained GitHub App private key>")
$env:GITHUB_PRIVATE_KEY_BASE64 = [Convert]::ToBase64String($pem)
vercel.cmd env run -e production -- node services/j3w1ctl-auth/bin/provider-acceptance.mjs --apply
Remove-Item Env:GITHUB_PRIVATE_KEY_BASE64 -ErrorAction SilentlyContinue
```

Never print, log, or persist the Base64 value. GitHub cannot reissue the private half of an existing key, so a lost file is recovered by rotation rather than re-download: generate a new private key, verify it, update the Production Secret, verify production, then revoke the old key.

Automatic Git deployment and automatic production-domain assignment for staged deployments are disabled. There is no dynamic target selector, permanent test branch, DigitalOcean fallback, or automatic publication retry.

## Operations and security

- Vercel WAF is rate/cost protection; session, owner, Origin, precondition, path, and CAS checks remain authoritative.
- Keep Helmet enabled without Cross-Origin-Opener-Policy because the exact-origin OAuth popup must retain `window.opener`. CSP, `frame-ancestors 'none'`, and `X-Frame-Options: DENY` protect the callback.
- Logs exclude headers, query strings, bodies, cookies, tokens, Blob objects, and photograph bytes. Responses expose stable error codes/messages and request IDs only.
- Recover published content through Git history and rebuild the deterministic index after manual corrections.
- Disable publication by suspending/uninstalling the GitHub App or removing Production credentials. Do not reactivate the retired DigitalOcean publisher.

The DigitalOcean App is handed to the separate CE Metadata Reconciler workstream only after this service is accepted on Vercel. This repository does not document or activate that system.
