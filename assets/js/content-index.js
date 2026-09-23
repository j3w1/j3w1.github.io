/* The published content index, fetched once per page. The public workspaces
   and the terminal's virtual filesystem both read it; sharing the promise
   means one request, not two, and one place that decides what "valid" means.

   `cache: "no-cache"` is deliberate: the index changes with every publish,
   independently of the site's dated ?v= tokens, so it is revalidated rather
   than pinned. */

const INDEX_URL = "/assets/data/content-index.json";
/* The Git-managed collections, in the order the desktop lists them. The
   service keeps its own copy (it deploys alone); test/shared-constants.test.js
   holds the two equal. */
export const COLLECTIONS = Object.freeze(["writing", "books", "photography"]);

let promise = null;

const isContentIndex = (candidate) =>
  Boolean(candidate) &&
  candidate.schemaVersion === 1 &&
  Boolean(candidate.collections) &&
  COLLECTIONS.every((name) => Array.isArray(candidate.collections[name]));

/* Resolves to the index, or null when it is missing or malformed. */
export const loadContentIndex = () => {
  promise ??= fetch(INDEX_URL, { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : null))
    .then((candidate) => (isContentIndex(candidate) ? candidate : null))
    .catch(() => null);
  return promise;
};
