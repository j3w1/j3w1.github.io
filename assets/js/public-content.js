import { renderAst } from "./content-renderer.js?v=20260824";
import { closePhotoViewer, isPhotoViewerBackdropClick } from "./photo-viewer.js?v=20260825b";
import { loadContentIndex } from "./content-index.js?v=20260905g";
import { parseRoute } from "./route.js?v=20260905g";

const collections = ["writing", "books", "photography"];
let index;
let photoReturnFocus = null;

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const setState = (collection, message, unavailable = false) => {
  document.querySelectorAll(`[data-content-status="${collection}"]`).forEach((target) => { target.textContent = message; });
  const list = document.querySelector(`[data-content-list="${collection}"]`);
  const detail = document.querySelector(`[data-content-detail="${collection}"]`);
  const state = element("div", "empty-directory compact-state");
  state.append(element("p", "empty-title", unavailable ? "Content unavailable." : `No public ${collection} entries yet.`));
  state.append(element("p", "", unavailable ? "The content index could not be read safely." : "Private drafts are not presented as public work."));
  list?.replaceChildren(state);
  detail?.replaceChildren();
};

const hashRoute = () => {
  const { workspace, slug } = parseRoute(location.hash);
  return { collection: workspace, slug };
};

/* Ask the window manager to surface the reader without depending on it: with no
   window manager present the event is simply unobserved. */
const openMobileDetail = (collection) => {
  const suffix = collection === "writing" ? "reader" : collection === "photography" ? "viewer" : "notes";
  document.dispatchEvent(new CustomEvent("wm:focus-window", {
    detail: { id: `${collection}-${suffix}` },
  }));
};

const selectRoute = () => {
  if (!index) return;
  const { collection, slug } = hashRoute();
  if (!collections.includes(collection)) return;
  const entries = index.collections[collection];
  document.querySelectorAll(`[data-content-entry="${collection}"]`).forEach((row) => {
    row.classList.toggle("is-selected", row.dataset.slug === slug);
    if (row.matches("button")) row.setAttribute("aria-pressed", String(row.dataset.slug === slug));
  });
  const target = entries.find((entry) => entry.slug === slug);
  const detail = document.querySelector(`[data-content-detail="${collection}"]`);
  if (!detail) return;
  if (!target) {
    detail.replaceChildren(element("p", "compact-state", entries.length ? "Select an entry to read it." : ""));
    return;
  }
  detail.replaceChildren();
  const header = element("header", "content-detail-header");
  header.append(element("h3", "", target.title));
  /* Every entry has a real page at /<collection>/<slug>/ — the address to
     share: crawlers and link previews can read that one. */
  const permalink = element("a", "content-permalink", "permalink");
  permalink.href = `/${collection}/${target.slug}/`;
  header.append(permalink);
  if (collection === "writing") header.append(element("p", "", `${target.date} · ${target.summary}`));
  if (collection === "books") header.append(element("p", "", `${target.author} · ${target.year} · ${target.status}`));
  if (collection === "photography") header.append(element("p", "", [target.date, target.location, target.camera].filter(Boolean).join(" · ")));
  detail.append(header);
  if (collection === "writing") renderAst(target.blocks, detail.appendChild(element("div", "rendered-content")));
  if (collection === "books") renderAst(target.notes, detail.appendChild(element("div", "rendered-content")));
  if (collection === "photography") {
    detail.append(element("p", "photo-caption", target.caption));
    const grid = element("div", "photo-grid");
    for (const image of target.images) {
      const button = element("button", "photo-thumb");
      button.type = "button";
      button.setAttribute("aria-label", `Open ${image.alt}`);
      const thumbnail = element("img");
      thumbnail.src = image.thumbnailSrc;
      thumbnail.alt = image.alt;
      /* Off-screen photographs cost nothing until the workspace is opened, and
         the grid reserves each image's real box so nothing shifts. */
      thumbnail.loading = "lazy";
      thumbnail.decoding = "async";
      if (image.thumbnailWidth && image.thumbnailHeight) {
        thumbnail.width = image.thumbnailWidth;
        thumbnail.height = image.thumbnailHeight;
      }
      if (image.width && image.thumbnailWidth) {
        thumbnail.srcset = `${image.thumbnailSrc} ${image.thumbnailWidth}w, ${image.src} ${image.width}w`;
        thumbnail.sizes = "(max-width: 767px) calc(100vw - 40px), 320px";
      }
      button.append(thumbnail);
      if (image.caption) button.append(element("span", "", image.caption));
      button.addEventListener("click", () => openPhoto(target, image, button));
      grid.append(button);
    }
    detail.append(grid);
  }
  openMobileDetail(collection);
};

const makeEntryButton = (collection, entry, number) => {
  const button = element("a", `content-entry ${collection}-entry`);
  button.href = `#${collection}/${encodeURIComponent(entry.slug)}`;
  button.dataset.contentEntry = collection;
  button.dataset.slug = entry.slug;
  if (collection === "writing") button.append(element("span", "content-number", String(number).padStart(2, "0")), element("span", "content-title", entry.title), element("span", "content-meta", entry.date));
  if (collection === "books") button.append(element("span", "content-title", entry.title), element("span", "content-meta", entry.author), element("span", "content-meta", String(entry.year)), element("span", "content-meta", entry.status));
  if (collection === "photography") button.append(element("span", "file-icon ui-icon", "\uf07b"), element("span", "content-title", `${entry.title}/`), element("span", "content-meta", `${entry.images.length} photographs`));
  return button;
};

const renderCollection = (collection) => {
  const entries = index.collections[collection];
  document.querySelectorAll(`[data-content-count="${collection}"]`).forEach((target) => { target.textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`; });
  document.querySelectorAll(`[data-content-status="${collection}"]`).forEach((target) => { target.textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`; });
  if (!entries.length) return setState(collection, "0 entries");
  const list = document.querySelector(`[data-content-list="${collection}"]`);
  const fragment = document.createDocumentFragment();
  if (collection === "books") {
    const head = element("div", "library-header");
    ["Title", "Author", "Year", "State"].forEach((label) => head.append(element("span", "", label)));
    fragment.append(head);
  } else if (collection === "photography") {
    const head = element("div", "file-row file-header");
    ["Name", "Contents", "Date"].forEach((label) => head.append(element("span", "", label)));
    fragment.append(head);
  } else {
    fragment.append(element("div", "code-line content-index-heading", "#  published writing"));
  }
  entries.forEach((entry, index) => fragment.append(makeEntryButton(collection, entry, index + 1)));
  list.replaceChildren(fragment);
};

const openPhoto = (entry, image, sourceThumbnail) => {
  const dialog = document.querySelector("#photo-viewer");
  const img = dialog.querySelector("img");
  photoReturnFocus = sourceThumbnail;
  img.src = image.src;
  img.alt = image.alt;
  if (image.width && image.height) {
    img.width = image.width;
    img.height = image.height;
  } else {
    img.removeAttribute("width");
    img.removeAttribute("height");
  }
  dialog.querySelector("figcaption").textContent = image.caption || entry.caption;
  dialog.querySelector("#photo-viewer-title").textContent = `${image.id}.webp — ristretto`;
  dialog.showModal();
};

const closePhoto = () => {
  const dialog = document.querySelector("#photo-viewer");
  const returnFocus = photoReturnFocus;
  photoReturnFocus = null;
  closePhotoViewer(dialog, returnFocus);
};

document.querySelector("[data-close-photo]")?.addEventListener("click", closePhoto);
document.querySelector("#photo-viewer")?.addEventListener("cancel", (event) => { event.preventDefault(); closePhoto(); });
document.querySelector("#photo-viewer")?.addEventListener("click", (event) => {
  if (isPhotoViewerBackdropClick(event)) closePhoto();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.querySelector("#photo-viewer")?.open) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closePhoto();
  }
}, true);
window.addEventListener("hashchange", selectRoute);
window.addEventListener("popstate", selectRoute);

const candidate = await loadContentIndex();
if (candidate) {
  index = candidate;
  collections.forEach(renderCollection);
  selectRoute();
} else {
  collections.forEach((collection) => setState(collection, "content unavailable", true));
}
