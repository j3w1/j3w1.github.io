import { renderAst } from "/assets/js/content-renderer.js?v=20260824";

const TOKEN_KEY = "j3w1ctl.session";
const COLLECTIONS = ["writing", "books", "photography"];
const STATES = new Set(["locked", "authenticating", "authenticated", "loading", "clean", "modified", "local draft", "publishing", "published", "conflict", "error", "offline"]);
let controller;

const node = (tag, className, text) => {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
};

const ensureStyle = () => {
  if (document.querySelector("#j3w1ctl-style")) return;
  const link = document.createElement("link");
  link.id = "j3w1ctl-style";
  link.rel = "stylesheet";
  link.href = "/admin/j3w1ctl.css?v=20260824c";
  document.head.append(link);
};

const apiOrigin = (value) => {
  try {
    const url = new URL(value);
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return "";
    if (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return url.origin;
  } catch {}
  return "";
};

const openDraftDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open("j3w1ctl", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "key" });
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve(request.result);
});

const draftOperation = async (mode, value) => {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", mode === "get" ? "readonly" : "readwrite");
    const store = transaction.objectStore("drafts");
    const request = mode === "put" ? store.put(value) : mode === "delete" ? store.delete(value) : mode === "clear" ? store.clear() : store.get(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
};

const field = (label, name, { type = "text", value = "", options, required = false, maxLength } = {}) => {
  const wrapper = node("label", "ctl-field");
  wrapper.append(node("span", "", label));
  let control;
  if (type === "textarea") control = node("textarea");
  else if (type === "select") {
    control = node("select");
    options.forEach(([optionValue, text]) => {
      const option = node("option", "", text);
      option.value = optionValue;
      option.selected = optionValue === value;
      control.append(option);
    });
  } else {
    control = node("input");
    control.type = type;
  }
  control.name = name;
  control.value = value ?? "";
  control.required = required;
  if (maxLength) control.maxLength = maxLength;
  wrapper.append(control);
  return wrapper;
};

const normalizeTags = (value) => value.split(",").map((tag) => tag.trim()).filter(Boolean);

class J3w1ctl {
  constructor({ mount, launcher, direct }) {
    this.mount = mount;
    this.launcher = launcher;
    this.direct = direct;
    this.token = sessionStorage.getItem(TOKEN_KEY) || "";
    this.collection = "writing";
    this.entry = null;
    this.entries = [];
    this.state = "locked";
    this.apiBase = "";
    this.popup = null;
    this.messageHandler = null;
    this.conflicted = false;
    this.conflictKey = null;
  }

  async open() {
    ensureStyle();
    if (!window.J3W1CTL_CONFIG) await import("/admin/config.js");
    this.apiBase = apiOrigin(window.J3W1CTL_CONFIG?.apiBaseUrl ?? "");
    this.renderShell();
    this.bindConnectivity();
    if (!this.apiBase) return this.renderLocked("Backend not configured. Set the permanent service URL in admin/config.js.", true);
    if (!this.token) return this.renderLocked();
    try {
      this.setState("loading", "validating session");
      await this.request("/api/session");
      await this.unlock();
    } catch {
      sessionStorage.removeItem(TOKEN_KEY);
      this.token = "";
      this.renderLocked("The previous session is no longer valid.");
    }
  }

  renderShell() {
    const overlay = node("section", "j3w1ctl-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", String(!this.direct));
    overlay.setAttribute("aria-label", "j3w1ctl content manager");
    const windowNode = node("div", "j3w1ctl-window");
    const title = node("header", "window-titlebar");
    title.append(node("span", "", "j3w1ctl — repository content control"));
    const actions = node("span", "ctl-title-actions");
    if (!this.direct) {
      const close = node("button", "", "×");
      close.type = "button"; close.setAttribute("aria-label", "Close j3w1ctl"); close.addEventListener("click", () => this.close());
      actions.append(close);
    }
    title.append(actions);
    this.body = node("div", "ctl-main-host");
    this.body.style.display = "contents";
    this.status = node("footer", "ctl-status");
    this.status.append(node("span", "", "LOCKED"), node("span", "", "GitHub repository"), node("span", "", "no session"));
    windowNode.append(title, this.body, this.status);
    overlay.append(windowNode);
    this.mount.replaceChildren(overlay);
    this.overlay = overlay;
  }

  close() {
    this.abortController?.abort();
    if (this.popup && !this.popup.closed) this.popup.close();
    if (this.messageHandler) window.removeEventListener("message", this.messageHandler);
    this.mount.replaceChildren();
    this.launcher?.focus();
    controller = null;
  }

  bindConnectivity() {
    window.addEventListener("offline", () => this.setState("offline", "local editing only"), { signal: this.abortSignal });
    window.addEventListener("online", () => this.setState(this.entry ? "modified" : "authenticated", "connection restored"), { signal: this.abortSignal });
  }

  setState(state, message = "") {
    if (!STATES.has(state)) throw new TypeError(`Unknown state ${state}`);
    this.state = state;
    const [mode, , tail] = this.status.children;
    mode.textContent = state.toUpperCase();
    mode.className = state === "offline" ? "ctl-offline" : state === "modified" ? "ctl-modified" : "";
    tail.textContent = message || (this.entry ? `${this.collection}/${this.entry.slug}` : this.collection);
    this.syncActions();
  }

  renderLocked(message = "Authenticate as the configured GitHub owner to edit published content.", unavailable = false) {
    this.setState("locked", unavailable ? "backend unavailable" : "no session");
    const wrap = node("div", "ctl-auth-wrap");
    const box = node("section", "ctl-auth");
    box.append(node("h3", "", "Authentication required"));
    const content = node("div", "ctl-auth-body");
    content.append(node("p", "", message), node("p", "", "Local drafts remain on this device and are hidden until j3w1ctl is unlocked."));
    const actions = node("div", "ctl-auth-actions");
    const cancel = node("button", "ctl-button", "Cancel"); cancel.type = "button"; cancel.addEventListener("click", () => this.close());
    const authenticate = node("button", "ctl-button ctl-button-primary", "Authenticate with GitHub"); authenticate.type = "button"; authenticate.disabled = unavailable; authenticate.addEventListener("click", (event) => this.authenticate(event));
    actions.append(cancel, authenticate); box.append(content, actions); wrap.append(box); this.body.replaceChildren(wrap);
  }

  authenticate() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const channel = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    this.popup = window.open(`${this.apiBase}/auth/github/start?channel=${encodeURIComponent(channel)}`, "j3w1ctl-github-auth", "popup,width=720,height=760");
    if (!this.popup) return this.setState("error", "GitHub popup was blocked");
    this.setState("authenticating", "waiting for GitHub");
    this.messageHandler = async (event) => {
      if (event.origin !== this.apiBase || event.source !== this.popup || event.data?.channel !== channel || !["j3w1ctl:auth-success", "j3w1ctl:auth-error"].includes(event.data?.type)) return;
      window.removeEventListener("message", this.messageHandler); this.messageHandler = null;
      if (event.data.type === "j3w1ctl:auth-error") return this.renderLocked(event.data.error || "GitHub authorization failed.");
      this.token = event.data.token;
      sessionStorage.setItem(TOKEN_KEY, this.token);
      await this.unlock();
    };
    window.addEventListener("message", this.messageHandler);
  }

  async unlock() {
    this.setState("authenticated", "session unlocked");
    this.renderManager();
    await this.loadCollection();
  }

  renderManager() {
    const menu = node("div", "ctl-menu");
    [["New", () => this.newEntry()], ["Save draft", () => this.saveDraft()], ["Preview", () => this.preview()], ["Publish", () => this.publish()], ["Logout", () => this.logout()]].forEach(([label, action]) => { const button = node("button", "", label); button.type = "button"; button.dataset.action = label.toLowerCase().replace(" ", "-"); button.addEventListener("click", action); menu.append(button); });
    const forget = node("button", "", "Forget local drafts"); forget.type = "button"; forget.addEventListener("click", () => this.forgetDrafts()); menu.append(forget);
    const mobile = node("div", "ctl-mobile-buffers");
    [["collections", "1 collections"], ["entries", "2 entries"], ["editor", "3 editor"], ["preview", "4 preview"]].forEach(([name, label], index) => { const button = node("button", "", label); button.type = "button"; button.dataset.buffer = name; button.setAttribute("aria-selected", String(index === 0)); button.addEventListener("click", () => this.showBuffer(name)); mobile.append(button); });
    this.manager = node("div", "ctl-manager"); this.manager.style.display = "contents";
    this.collectionPane = node("aside", "ctl-pane ctl-collections is-mobile-active"); this.collectionPane.dataset.bufferPane = "collections"; this.collectionPane.append(node("h3", "ctl-pane-title", "/content"));
    COLLECTIONS.forEach((name) => { const button = node("button", "ctl-collection"); button.type = "button"; button.dataset.collection = name; button.setAttribute("aria-pressed", String(name === this.collection)); button.append(node("span", "ui-icon", name === "writing" ? "\uf044" : name === "books" ? "\uf02d" : "\uf030"), node("span", "", name)); button.addEventListener("click", () => this.changeCollection(name)); this.collectionPane.append(button); });
    this.entryPane = node("section", "ctl-pane ctl-entries"); this.entryPane.dataset.bufferPane = "entries";
    this.editorPane = node("section", "ctl-pane ctl-editor"); this.editorPane.dataset.bufferPane = "editor";
    this.previewPane = node("section", "ctl-pane ctl-preview-pane"); this.previewPane.dataset.bufferPane = "preview";
    const main = node("div", "ctl-main"); main.append(this.collectionPane, this.entryPane, this.editorPane, this.previewPane);
    this.body.replaceChildren(menu, mobile, main);
    this.syncActions();
  }

  showBuffer(name) {
    this.body.querySelectorAll("[data-buffer-pane]").forEach((pane) => pane.classList.toggle("is-mobile-active", pane.dataset.bufferPane === name));
    this.body.querySelectorAll("[data-buffer]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.buffer === name)));
  }

  async changeCollection(name) {
    this.collection = name; this.entry = null;
    this.collectionPane.querySelectorAll("[data-collection]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.collection === name)));
    await this.loadCollection(); this.showBuffer("entries");
  }

  async loadCollection() {
    if (!navigator.onLine) return this.setState("offline", "collection refresh unavailable");
    this.setState("loading", `reading ${this.collection}`);
    try {
      const data = await this.request(`/api/content/${this.collection}`);
      this.entries = data.entries;
      this.renderEntries();
      this.newEntry(false);
      this.setState("authenticated", `${this.entries.length} remote entries`);
    } catch (error) { this.setState("error", error.message); }
  }

  renderEntries() {
    this.entryPane.replaceChildren(node("h3", "ctl-pane-title", `/content/${this.collection}`));
    const fresh = node("button", "ctl-entry", "+ new entry"); fresh.type = "button"; fresh.addEventListener("click", () => this.newEntry()); this.entryPane.append(fresh);
    for (const entry of this.entries) {
      const button = node("button", "ctl-entry", entry.title); button.type = "button"; button.dataset.slug = entry.slug; button.setAttribute("aria-pressed", String(this.entry?.slug === entry.slug)); button.addEventListener("click", () => this.selectEntry(entry.slug)); this.entryPane.append(button);
    }
  }

  async selectEntry(slug, { ignoreDraft = false } = {}) {
    this.setState("loading", `reading ${this.collection}/${slug}`);
    try {
      const data = await this.request(`/api/content/${this.collection}/${encodeURIComponent(slug)}`);
      this.entry = { ...data.entry, body: data.body, version: data.version, persisted: true };
      const selectedKey = `${this.collection}/${slug}`;
      this.conflicted = !ignoreDraft && this.conflictKey === selectedKey;
      if (ignoreDraft) this.conflictKey = null;
      const draft = ignoreDraft ? null : await draftOperation("get", `${this.collection}/${slug}`);
      this.renderEditor(draft?.value ?? this.entry, draft?.files ?? []);
      this.renderEntries(); this.setState(draft ? "local draft" : "clean"); this.showBuffer("editor");
    } catch (error) { this.setState("error", error.message); }
  }

  newEntry(show = true) {
    this.conflicted = false;
    this.entry = { slug: "", title: "", body: "", persisted: false };
    this.renderEditor(this.entry, []); this.previewPane.replaceChildren(node("h3", "ctl-pane-title", "preview"), node("p", "ctl-preview", "Preview is generated by the authenticated service.")); this.setState("clean", "new unpublished entry");
    if (show) this.showBuffer("editor");
  }

  renderEditor(value, files = []) {
    const form = node("form", "ctl-form"); form.addEventListener("submit", (event) => event.preventDefault());
    form.append(field("Title", "title", { value: value.title, required: true, maxLength: 120 }), field("Slug (immutable after publish)", "slug", { value: value.slug, required: true, maxLength: 80 }));
    if (this.collection === "writing") form.append(field("Date", "date", { type: "date", value: value.date, required: true }), field("Summary", "summary", { type: "textarea", value: value.summary, required: true, maxLength: 500 }), field("Tags (comma separated)", "tags", { value: (value.tags ?? []).join(", ") }), field("Markdown", "body", { type: "textarea", value: value.body, required: true }));
    if (this.collection === "books") form.append(field("Author", "author", { value: value.author, required: true }), field("Year", "year", { type: "number", value: value.year, required: true }), field("Status", "status", { type: "select", value: value.status || "want-to-read", options: [["want-to-read", "Want to read"], ["reading", "Reading"], ["finished", "Finished"], ["abandoned", "Abandoned"]] }), field("Rating (0–5)", "rating", { type: "number", value: value.rating }), field("Started", "started", { type: "date", value: value.started }), field("Finished", "finished", { type: "date", value: value.finished }), field("Tags (comma separated)", "tags", { value: (value.tags ?? []).join(", ") }), field("Markdown notes", "body", { type: "textarea", value: value.body }));
    if (this.collection === "photography") {
      form.append(field("Date", "date", { type: "date", value: value.date, required: true }), field("Caption", "caption", { type: "textarea", value: value.caption, required: true, maxLength: 500 }), field("Location", "location", { value: value.location }), field("Camera", "camera", { value: value.camera }));
      this.pairs = node("div", "ctl-photo-pairs");
      (value.images ?? []).forEach((image) => this.addImagePair(image, files.find((pair) => pair.id === image.id)));
      const add = node("button", "ctl-button", "Add WebP pair"); add.type = "button"; add.addEventListener("click", () => this.addImagePair()); form.append(this.pairs, add);
    }
    if (value.persisted || this.entry?.persisted) form.querySelector('[name="slug"]').readOnly = true;
    form.addEventListener("input", () => this.setState(navigator.onLine ? "modified" : "offline", navigator.onLine ? "unsaved changes" : "local editing only"));
    this.form = form; this.editorPane.replaceChildren(node("h3", "ctl-pane-title", `${this.collection}/${value.slug || "new"}`), form);
  }

  addImagePair(image = {}, saved = {}) {
    const row = node("fieldset", "ctl-photo-pairs"); row.dataset.imagePair = "";
    row.append(field("Image id", "imageId", { value: image.id, required: true }), field("Alt text", "imageAlt", { value: image.alt, required: true, maxLength: 500 }), field("Image caption", "imageCaption", { value: image.caption, maxLength: 500 }), field("Full WebP (max 2 MiB)", "full", { type: "file" }), field("Thumbnail WebP (max 256 KiB)", "thumbnail", { type: "file" }));
    row.querySelector('[name="full"]').accept = "image/webp"; row.querySelector('[name="thumbnail"]').accept = "image/webp";
    row.savedFiles = saved;
    const remove = node("button", "ctl-button ctl-button-danger", "Remove pair"); remove.type = "button"; remove.addEventListener("click", () => { row.remove(); this.setState("modified", "photography order changed"); }); row.append(remove); this.pairs.append(row);
  }

  editorValue() {
    const data = Object.fromEntries(new FormData(this.form));
    const common = { title: data.title, slug: data.slug };
    if (this.collection === "writing") return { ...common, date: data.date, summary: data.summary, tags: normalizeTags(data.tags), body: data.body };
    if (this.collection === "books") return { ...common, author: data.author, year: Number(data.year), status: data.status, ...(data.rating ? { rating: Number(data.rating) } : {}), ...(data.started ? { started: data.started } : {}), ...(data.finished ? { finished: data.finished } : {}), tags: normalizeTags(data.tags), body: data.body };
    const images = []; const files = [];
    this.pairs.querySelectorAll("[data-image-pair]").forEach((row) => {
      const id = row.querySelector('[name="imageId"]').value.trim(); const full = row.querySelector('[name="full"]').files[0] || row.savedFiles?.full; const thumbnail = row.querySelector('[name="thumbnail"]').files[0] || row.savedFiles?.thumbnail;
      images.push({ id, file: `${id}.webp`, thumbnail: `${id}-thumb.webp`, alt: row.querySelector('[name="imageAlt"]').value, ...(row.querySelector('[name="imageCaption"]').value ? { caption: row.querySelector('[name="imageCaption"]').value } : {}) });
      files.push({ id, full, thumbnail });
    });
    return { ...common, date: data.date, caption: data.caption, ...(data.location ? { location: data.location } : {}), ...(data.camera ? { camera: data.camera } : {}), images, body: "", files };
  }

  draftKey(value = this.editorValue()) { return `${this.collection}/${value.slug || "new"}`; }

  async saveDraft() {
    const value = this.editorValue(); const files = value.files ?? []; delete value.files;
    await draftOperation("put", { key: this.draftKey(value), collection: this.collection, value, files });
    this.setState("local draft", "saved on this device");
  }

  async forgetDrafts() {
    if (!await this.confirm("Forget local drafts?", "This permanently removes every local j3w1ctl draft and selected photograph blob from this browser.")) return;
    await draftOperation("clear"); this.setState(this.entry?.persisted ? "clean" : "authenticated", "local drafts removed");
  }

  async preview() {
    if (!navigator.onLine) return this.setState("offline", "preview requires the service");
    if (matchMedia("(min-width: 768px) and (max-width: 1100px)").matches && this.previewPane.classList.contains("is-visible")) {
      this.previewPane.classList.remove("is-visible");
      return this.setState(this.entry ? "modified" : "authenticated", "preview hidden");
    }
    const value = this.editorValue(); const body = value.body; delete value.body; delete value.files;
    this.setState("loading", "validating preview");
    try {
      const result = await this.request(`/api/preview/${this.collection}`, { method: "POST", body: JSON.stringify({ metadata: value, body }) });
      this.previewPane.replaceChildren(node("h3", "ctl-pane-title", `preview — ${value.title}`)); const rendered = node("div", "ctl-preview"); renderAst(result.blocks, rendered); this.previewPane.append(rendered); this.previewPane.classList.add("is-visible"); this.setState("modified", "preview validated"); this.showBuffer("preview");
    } catch (error) { this.setState("error", error.message); }
  }

  async publish() {
    if (!navigator.onLine) return this.setState("offline", "publication requires the service");
    const value = this.editorValue(); const files = value.files; delete value.files; const markdownBody = value.body; delete value.body;
    const persisted = Boolean(this.entry?.persisted); const path = persisted ? `/api/content/${this.collection}/${encodeURIComponent(this.entry.slug)}` : `/api/content/${this.collection}`;
    const options = { method: persisted ? "PUT" : "POST", headers: persisted ? { "If-Match": `"${this.entry.version}"` } : { "If-None-Match": "*" } };
    if (this.collection === "photography") { const form = new FormData(); form.append("metadata", JSON.stringify(value)); for (const pair of files) { if (pair.full instanceof Blob) form.append(`full.${pair.id}`, pair.full, `${pair.id}.webp`); if (pair.thumbnail instanceof Blob) form.append(`thumbnail.${pair.id}`, pair.thumbnail, `${pair.id}-thumb.webp`); } options.body = form; }
    else { options.body = JSON.stringify({ metadata: value, body: markdownBody }); }
    this.setState("publishing", "one atomic GitHub commit");
    try {
      const result = await this.request(path, options); await draftOperation("delete", this.draftKey(value)); this.conflicted = false; this.conflictKey = null; this.setState("published", result.commitSha); await this.loadCollection(); await this.selectEntry(value.slug);
    } catch (error) {
      if (error.code === "content_conflict") { await this.saveDraft(); this.conflicted = true; this.conflictKey = this.draftKey(value); this.setState("conflict", "remote content changed; local draft preserved"); this.renderConflict(); }
      else this.setState("error", error.message);
    }
  }

  renderConflict() {
    const actions = node("div", "ctl-actions"); const reload = node("button", "ctl-button", "Reload remote"); reload.type = "button"; reload.addEventListener("click", () => this.selectEntry(this.entry.slug, { ignoreDraft: true })); const keep = node("button", "ctl-button ctl-button-primary", "Keep local draft"); keep.type = "button"; keep.addEventListener("click", () => this.setState("local draft", "publication disabled until remote is reloaded")); actions.append(reload, keep); this.editorPane.append(actions);
  }

  async deleteEntry() {
    if (!this.entry?.persisted || !navigator.onLine) return;
    const paths = [`content/${this.collection}/${this.entry.slug}.md`];
    if (this.collection === "photography") for (const image of this.entry.images ?? []) paths.push(image.src.replace(/^\//, ""), image.thumbnailSrc.replace(/^\//, ""));
    if (!await this.confirm(`Delete ${this.entry.title}?`, `One commit will delete:\n${paths.join("\n")}`)) return;
    try { await this.request(`/api/content/${this.collection}/${encodeURIComponent(this.entry.slug)}`, { method: "DELETE", headers: { "If-Match": `"${this.entry.version}"` } }); await draftOperation("delete", this.draftKey(this.entry)); await this.loadCollection(); this.setState("published", "deletion committed"); } catch (error) { this.setState(error.code === "content_conflict" ? "conflict" : "error", error.message); }
  }

  confirm(title, message) {
    return new Promise((resolve) => {
      const dialog = node("dialog", "ctl-dialog"); const header = node("header", "window-titlebar"); header.append(node("span", "", title)); const body = node("div", "ctl-dialog-body", message); const actions = node("div", "ctl-actions"); const cancel = node("button", "ctl-button", "Cancel"); const confirm = node("button", "ctl-button ctl-button-danger", "Confirm"); [cancel, confirm].forEach((button) => { button.type = "button"; actions.append(button); }); cancel.addEventListener("click", () => { dialog.close(); resolve(false); }); confirm.addEventListener("click", () => { dialog.close(); resolve(true); }); dialog.addEventListener("close", () => dialog.remove(), { once: true }); dialog.append(header, body, actions); document.body.append(dialog); dialog.showModal();
    });
  }

  async logout() {
    const token = this.token; sessionStorage.removeItem(TOKEN_KEY); this.token = ""; this.renderLocked("Signed out. Local drafts remain on this device.");
    if (token) fetch(`${this.apiBase}/api/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }

  syncActions() {
    if (!this.body) return;
    const publishing = this.state === "publishing"; const offline = !navigator.onLine || this.state === "offline"; const conflict = this.conflicted || this.state === "conflict";
    this.body.querySelector('[data-action="publish"]')?.toggleAttribute("disabled", publishing || offline || conflict);
    this.body.querySelector('[data-action="preview"]')?.toggleAttribute("disabled", offline);
    let deleteButton = this.body.querySelector('[data-action="delete"]');
    if (this.entry?.persisted && !deleteButton) { deleteButton = node("button", "", "Delete"); deleteButton.type = "button"; deleteButton.dataset.action = "delete"; deleteButton.addEventListener("click", () => this.deleteEntry()); this.body.querySelector(".ctl-menu")?.append(deleteButton); }
    if (deleteButton) deleteButton.disabled = !this.entry?.persisted || offline || publishing;
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    let response;
    try { response = await fetch(`${this.apiBase}${path}`, { ...options, headers }); } catch { throw Object.assign(new Error("The service is offline."), { code: "offline" }); }
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(payload?.error?.message || "The service rejected the request."), { code: payload?.error?.code || "request_failed", requestId: payload?.error?.requestId });
    return payload;
  }
}

export const openJ3w1ctl = async (options) => {
  if (controller) return controller;
  controller = new J3w1ctl(options);
  controller.abortController = new AbortController();
  controller.abortSignal = controller.abortController.signal;
  await controller.open();
  return controller;
};
