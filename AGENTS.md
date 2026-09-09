# j3w1.github.io agent instructions

Inspect the worktree and [README](README.md) before editing. Preserve unrelated work and the
dependency-free GitHub Pages architecture, Git-managed content, deterministic generated artifacts,
and separate authenticated `j3w1ctl-auth` trust boundary. Do not expose credentials, private staged
media, personal data, or provider configuration. Metadata work does not authorize site publication,
backend deployment, domain changes, or production mutation.

## CE Metadata Reconciler integration

This active-managed repository has role `personal-site-adjacent`; protected CE label prefixes are
`ce-systems`, `cross-repo`, `historical-evidence`, `type:`, `area:`, and `concern:`. Its membership
writer is `OWNER_AUTHENTICATED_BRIDGE`, written owner-locally over exactly the keys a reviewed act
enumerates — the hosted App holds no Project credential and cannot execute an admission. No object
in this repository is enumerated today, so nothing here reaches the Project on its own. Those values
are reviewed policy, not local claims: read them from
[`policy/repositories.yaml`](https://github.com/j3w1/ce-metadata-reconciler/blob/main/policy/repositories.yaml)
and verify the current surface grant and proven writer before any operation. Follow the
[canonical manual](https://github.com/j3w1/casaelida.com/tree/main/docs/operations/metadata-reconciler)
and [machine policy](https://github.com/j3w1/ce-metadata-reconciler/tree/main/policy); report
`HOLD`, `CONFLICT`, `NEEDS_REVIEW`, or policy/installation drift to
[`ce-metadata-reconciler#2`](https://github.com/j3w1/ce-metadata-reconciler/issues/2).

CE Metadata Reconciler owns only metadata surfaces explicitly activated by protected policy and
rollout authority. Do not create competing label, dashboard, or Project automation. Its output
never grants source, task, review, merge, publication, release, deployment, or production authority.
