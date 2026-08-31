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

export const J3W1CTL_SUPPORTED_PROTOCOLS = Object.freeze([1]);
export const FIXED_PUBLICATION_TARGET = Object.freeze({ owner: "j3w1", name: "j3w1.github.io", branch: "main" });

export const protocolCompatibility = (value) => ({
  protocolVersion: value,
  compatible: Number.isInteger(value) && J3W1CTL_SUPPORTED_PROTOCOLS.includes(value),
});

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
  const live = repository?.owner === FIXED_PUBLICATION_TARGET.owner
    && repository?.name === FIXED_PUBLICATION_TARGET.name
    && repository?.branch === FIXED_PUBLICATION_TARGET.branch;
  return {
    label: live ? "j3w1/j3w1.github.io · git:main · LIVE" : "Fixed publication target unavailable",
    mode: live ? "LIVE" : "INCOMPATIBLE",
    live,
  };
};

export const shortCommit = (sha) => typeof sha === "string" && /^[0-9a-f]{7,64}$/i.test(sha) ? sha.slice(0, 8) : "commit recorded";
