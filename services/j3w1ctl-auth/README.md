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

The preflight is zero-mutation. With no provider credentials it checks source, lock, protocol, fixed-target, secret-scan, and cutover invariants and marks credential-dependent checks unavailable. With Production credentials it additionally creates, reads, and removes one disposable Redis TTL key and one private Blob object. `--json` emits strict machine-readable results. Provider setup and acceptance use separately named commands.

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

The Vercel project is `j3w1ctl-auth`, linked to `j3w1/j3w1.github.io` with Root Directory `services/j3w1ctl-auth`, Node 24, Fastify Functions/Fluid compute, and `git.deploymentEnabled=false`. `vercel.json` schedules the bounded staging cleanup. No Next.js wrapper is used.

Provider activation sequence:

1. Configure Production-only secrets and exact `CMS_SITE_ORIGIN=https://j3w1.github.io` and `<production-origin>/auth/github/callback`; keep Preview free of production credentials.
2. Enable Standard Deployment Protection for Preview and generated deployment URLs. Keep the production API origin public.
3. Configure Vercel WAF limits for OAuth start/callback, authenticated reads, and mutation/upload controls. Identity and Origin checks remain application-level.
4. Review team metered spend, then enable low web/email notifications and automatic production pause at a threshold above fixed plan/seat charges and normal low-volume traffic.
5. Build a protected Preview with `vercel deploy`; it must report `configured=false` and remain zero-write.
6. Stage the exact reviewed commit with `vercel --prod --skip-domain`, run preflight and provider acceptance, then promote only that deployment with `vercel promote <exact-deployment>`.
7. Put the accepted production origin alone in `admin/config.js`, publish through the reviewed repository path, and verify GitHub Pages and the real browser flow.

Automatic Git deployment and automatic production-domain assignment for staged deployments are disabled. There is no dynamic target selector, permanent test branch, DigitalOcean fallback, or automatic publication retry.

## Operations and security

- Vercel WAF is rate/cost protection; session, owner, Origin, precondition, path, and CAS checks remain authoritative.
- Keep Helmet enabled without Cross-Origin-Opener-Policy because the exact-origin OAuth popup must retain `window.opener`. CSP, `frame-ancestors 'none'`, and `X-Frame-Options: DENY` protect the callback.
- Logs exclude headers, query strings, bodies, cookies, tokens, Blob objects, and photograph bytes. Responses expose stable error codes/messages and request IDs only.
- Recover published content through Git history and rebuild the deterministic index after manual corrections.
- Disable publication by suspending/uninstalling the GitHub App or removing Production credentials. Do not reactivate the retired DigitalOcean publisher.

The DigitalOcean App is handed to the separate CE Metadata Reconciler workstream only after this service is accepted on Vercel. This repository does not document or activate that system.
