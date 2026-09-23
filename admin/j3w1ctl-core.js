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

/* The publish/update/delete lock: an activity gate whose holder never needs to
   prove ownership, so entering answers yes or no and leaving takes no token. */
export class MutationGate extends ActivityGate {
  enter(action) {
    return super.enter(action) !== null;
  }

  leave() {
    return super.leave(this.owner);
  }
}

/* The j3w1ctl API origin from configuration: https anywhere, http only on the
   loopback, and nothing but an origin (no path, query, fragment or
   credentials). Anything else is refused as "". */
export const apiOrigin = (value) => {
  try {
    const url = new URL(value);
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return "";
    if (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return url.origin;
  } catch {}
  return "";
};

export const J3W1CTL_SUPPORTED_PROTOCOLS = Object.freeze([1]);
export const FIXED_PUBLICATION_TARGET = Object.freeze({ owner: "j3w1", name: "j3w1.github.io", branch: "main" });

export const protocolCompatibility = (value) => ({
  protocolVersion: value,
  compatible: Number.isInteger(value) && J3W1CTL_SUPPORTED_PROTOCOLS.includes(value),
});

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
