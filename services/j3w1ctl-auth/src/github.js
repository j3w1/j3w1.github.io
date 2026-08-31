import { createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";
import { AppError, conflict, publicationUnknown, unavailable } from "./errors.js";

const apiError = (message = "GitHub is unavailable.") => new AppError(502, "github_error", message);

const parseResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const ACCEPTANCE_BRANCH = /^migration\/j3w1ctl-vercel-acceptance-\d{8}t\d{6}z-[0-9a-f]{8}$/;

const createClient = (config, targetBranch, { fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000) } = {}) => {
  let appKeyPromise;
  let installationCache;

  const request = async (url, requestOptions = {}, token) => {
    const { effectful = false, ...options } = requestOptions;
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        signal: options.signal ?? AbortSignal.timeout(20_000),
        headers: {
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "j3w1ctl-auth",
          "X-GitHub-Api-Version": config.githubApiVersion,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });
    } catch {
      if (effectful) throw publicationUnknown();
      throw apiError();
    }
    const body = await parseResponse(response);
    if (!response.ok) {
      if (response.status === 409 || response.status === 422) throw conflict();
      if (effectful) throw publicationUnknown();
      throw apiError(response.status === 403 ? "GitHub rejected the configured App permissions." : undefined);
    }
    return body;
  };

  const appJwt = async () => {
    if (!config.githubPrivateKeyBase64) throw unavailable();
    appKeyPromise ??= Promise.resolve().then(() => {
      const pem = Buffer.from(config.githubPrivateKeyBase64, "base64").toString("utf8").replaceAll("\\n", "\n");
      return createPrivateKey(pem);
    });
    const key = await appKeyPromise;
    const issuedAt = now() - 30;
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(config.githubAppId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 9 * 60)
      .sign(key);
  };

  const installationToken = async () => {
    if (installationCache && installationCache.expiresAt - 120 > now()) return installationCache.token;
    const jwt = await appJwt();
    const installation = await request(
      `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}/installation`,
      {},
      jwt,
    );
    const tokenResponse = await request(
      `https://api.github.com/app/installations/${installation.id}/access_tokens`,
      {
        method: "POST",
        effectful: true,
        body: JSON.stringify({
          repositories: [config.githubRepo],
          permissions: { contents: "write" },
        }),
      },
      jwt,
    );
    installationCache = {
      token: tokenResponse.token,
      expiresAt: Math.floor(new Date(tokenResponse.expires_at).valueOf() / 1000),
    };
    return installationCache.token;
  };

  const exchangeOAuthCode = async ({ code, verifier }) =>
    request("https://github.com/login/oauth/access_token", {
      method: "POST",
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code,
        redirect_uri: config.callbackUrl,
        code_verifier: verifier,
      }),
    });

  const getUser = async (token) => request("https://api.github.com/user", {}, token);

  const revokeUserToken = async (token) => {
    const basic = Buffer.from(`${config.githubClientId}:${config.githubClientSecret}`).toString("base64");
    await request(
      `https://api.github.com/applications/${encodeURIComponent(config.githubClientId)}/token`,
      {
        method: "DELETE",
        headers: { Authorization: `Basic ${basic}` },
        body: JSON.stringify({ access_token: token }),
      },
    );
  };

  const rest = async (path, options = {}) => request(`https://api.github.com${path}`, options, await installationToken());

  const getSnapshot = async () => {
    const owner = encodeURIComponent(config.githubOwner);
    const repo = encodeURIComponent(config.githubRepo);
    const ref = await rest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(targetBranch)}`);
    const headSha = ref.object.sha;
    const commit = await rest(`/repos/${owner}/${repo}/git/commits/${headSha}`);
    const tree = await rest(`/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw apiError("The repository tree is too large for safe publication.");
    const files = new Map(
      tree.tree
        .filter((entry) => entry.type === "blob")
        .map((entry) => [entry.path, { sha: entry.sha, size: entry.size }]),
    );
    const contentPaths = [...files.keys()].filter((filePath) => /^content\/(writing|books|photography)\/[^/]+\.md$/.test(filePath));
    await Promise.all(
      contentPaths.map(async (filePath) => {
        const file = files.get(filePath);
        const blob = await rest(`/repos/${owner}/${repo}/git/blobs/${file.sha}`);
        const buffer = Buffer.from((blob.content ?? "").replace(/\s/g, ""), blob.encoding === "base64" ? "base64" : "utf8");
        file.source = buffer.toString("utf8");
      }),
    );
    return { headSha, treeSha: commit.tree.sha, files };
  };

  const createCommit = async ({ expectedHeadOid, headline, additions, deletions }) => {
    const query = `mutation CreateCommit($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) {
        commit { oid url }
        ref { target { oid } }
      }
    }`;
    const body = await request(
      "https://api.github.com/graphql",
      {
        method: "POST",
        body: JSON.stringify({
          query,
          variables: {
            input: {
              branch: {
                repositoryNameWithOwner: config.repositoryNameWithOwner,
                branchName: targetBranch,
              },
              expectedHeadOid,
              message: { headline },
              fileChanges: {
                additions: additions.map(({ path, content }) => ({
                  path,
                  contents: Buffer.from(content).toString("base64"),
                })),
                deletions: deletions.map((filePath) => ({ path: filePath })),
              },
            },
          },
        }),
      },
      await installationToken(),
    );
    if (body.errors?.length) {
      const messages = body.errors.map((error) => error.message).join(" ");
      if (/expectedHeadOid|head.*changed|out of date/i.test(messages)) throw conflict();
      throw publicationUnknown();
    }
    const result = body.data?.createCommitOnBranch;
    if (!result?.commit?.oid || result.ref?.target?.oid !== result.commit.oid) {
      throw publicationUnknown();
    }
    return { commitSha: result.commit.oid, commitUrl: result.commit.url };
  };

  return {
    exchangeOAuthCode,
    getUser,
    revokeUserToken,
    getSnapshot,
    createCommit,
  };
};

export const createGitHubClient = (config, dependencies) => createClient(config, config.githubBranch, dependencies);

export const createAcceptanceGitHubClient = (config, branch, dependencies) => {
  if (!ACCEPTANCE_BRANCH.test(branch)) throw new TypeError("The acceptance branch name is invalid.");
  return createClient(config, branch, dependencies);
};
