export class MutationGate {
  constructor() {
    this.inFlight = false;
    this.action = "";
  }

  enter(action) {
    if (this.inFlight) return false;
    this.inFlight = true;
    this.action = action;
    return true;
  }

  leave() {
    this.inFlight = false;
    this.action = "";
  }
}

export const publicationTarget = (repository) => {
  if (!repository?.owner || !repository?.name || !repository?.branch) {
    return { label: "GitHub repository", mode: "UNKNOWN", live: false };
  }
  const live = repository.branch === "main";
  return {
    label: `${repository.owner}/${repository.name} · git:${repository.branch} · ${live ? "LIVE" : "SANDBOX"}`,
    mode: live ? "LIVE" : "SANDBOX",
    live,
  };
};

export const shortCommit = (sha) => typeof sha === "string" && /^[0-9a-f]{7,64}$/i.test(sha) ? sha.slice(0, 8) : "commit recorded";
