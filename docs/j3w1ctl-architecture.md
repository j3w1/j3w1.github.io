# j3w1ctl architecture

The public site and `/admin/` client remain dependency-free static GitHub Pages assets. `content/**` is authoritative, `assets/data/content-index.json` is deterministic public output, and both the site and j3w1ctl preview consume the same restricted-AST renderer. Raw HTML is disabled and CMS-controlled strings are inserted as text.

The publication service is Node 24 and Fastify on Vercel Functions. Its source constants bind every deployed read and write to `j3w1/j3w1.github.io@main`. Owner, repository, and branch are not accepted from environment variables, requests, headers, cookies, sessions, browser state, or provider features. GitHub remains canonical storage.

## Browser and protocol boundary

The browser fetches `/healthz` before enabling authentication, then checks `/api/session` after OAuth. Both responses carry integer API protocol version `1`, bounded Vercel provenance, and the fixed repository identity. A missing, malformed, lower, or higher unsupported version keeps mutation controls locked; there is no best-effort fallback. Safe UI provenance is limited to the provider/runtime/environment, source revision, deployment identity, region, protocol, and fixed target.

The OAuth popup keeps PKCE, authenticated/encrypted state in a short-lived secure HttpOnly cookie, and exact `origin`, popup `source`, message `type`, and channel checks. The temporary GitHub user token is revoked after exact numeric owner ID and normalized login verification. The resulting bearer token is opaque, stored in browser `sessionStorage`, and represented in Redis only by a SHA-256-keyed record with a 3,600-second TTL. Shared storage makes verification and logout effective across Function instances. GitHub OAuth and installation tokens are never persisted.

## Publication and concurrency

The service exposes no general GitHub proxy. It validates one of three content schemas, derives every path, reads one branch snapshot, enforces exact blob/create preconditions, rebuilds the full index, and calls `createCommitOnBranch` once with `expectedHeadOid`. GitHub compare-and-swap is the authoritative concurrency decision; there is no process-local or distributed mutation lock. Independent instances may read the same head, but only one stale competing write can succeed. A conflict is surfaced without reread-and-write. An ambiguous write receives one read-only result check and is classified as proven success, proven failure, or hold unknown; hold never triggers another write.

## Private photography staging

The browser accepts JPG/JPEG/PNG/WebP, applies decoded orientation, preserves aspect ratio and transparency, avoids upscaling, and generates bounded WebP full/thumbnail pairs. Original source files remain browser-local. An authenticated, origin-checked upload batch binds one random batch ID to the owner session, slug, action, preconditions, expected image IDs, server-derived private Blob paths, and a 30-minute TTL. Client upload capabilities allow only `image/webp` at those exact paths and source limits.

Finalize is a small JSON request. The server claims the batch once, revalidates owner/session, expiry, object set, MIME, individual and aggregate size, WebP bytes, metadata, preconditions, and branch CAS before one GitHub commit attempt. Proven conflicts and validation failures remove staging; ambiguous publication retains staging only for bounded investigation. Successful staging is deleted, and an authenticated hourly Vercel Cron removes only abandoned objects beneath `staging/j3w1ctl/` after the six-hour retention ceiling. Blob is never a permanent publication store.

## Provider controls

Vercel WAF is abuse and cost control, not authorization. Provider rules rate-limit OAuth start/callback, authenticated reads, and mutation/upload control endpoints. Standard Deployment Protection covers Preview and generated deployment URLs while the production API origin remains publicly reachable by GitHub Pages. Spend Management notifications and automatic production pause are team-scoped and must be read back before activation. Production secrets exist only in Production; Preview has none of the GitHub App, OAuth, Redis, Blob, or session secrets and therefore remains zero-write.

Production deployment is manual: `vercel deploy` for protected Preview, `vercel --prod --skip-domain` for staged Production, and `vercel promote <exact-deployment>` after acceptance. Git-driven deployment is disabled. There is no retained DigitalOcean publisher, automatic failover, or post-cutover rollback path.

## Trust-domain boundary

A future private general-purpose j3w1ctl may own device registry, enrollment, presence, route leases, relay policy, audit events, project/session continuity, and bounded personal automation. It must be a separate repository and service with separate credentials, data, and relay identities. It must not reuse this site-publisher GitHub App, CE Systems credentials, or merge personal and CE trust domains.
