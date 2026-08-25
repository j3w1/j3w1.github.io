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

export class ActivityGate {
  constructor() {
    this.inFlight = false;
    this.action = "";
    this.sequence = 0;
    this.owner = null;
  }

  enter(action) {
    if (this.inFlight) return null;
    this.inFlight = true;
    this.action = action;
    this.owner = Object.freeze({ action, sequence: ++this.sequence });
    return this.owner;
  }

  owns(owner) {
    return this.inFlight && this.owner === owner;
  }

  leave(owner) {
    if (!this.owns(owner)) return false;
    this.inFlight = false;
    this.action = "";
    this.owner = null;
    return true;
  }
}

export class ObjectUrlRegistry {
  constructor(urlApi = URL) {
    this.urlApi = urlApi;
    this.urls = new Set();
  }

  create(blob) {
    const url = this.urlApi.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  revokeAll() {
    for (const url of this.urls) this.urlApi.revokeObjectURL(url);
    this.urls.clear();
  }
}

export const buildPhotographyPreviewItems = ({ images, photoItems, persisted, slug, createObjectUrl }) => images.map((image) => {
  const item = photoItems.find((candidate) => candidate.id === image.id);
  const localBlob = item?.full?.blob;
  const source = localBlob instanceof Blob
    ? createObjectUrl(localBlob)
    : item?.publicSrc || (persisted ? `/assets/photography/${slug}/${image.file}` : "");
  return { ...image, source };
});

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
