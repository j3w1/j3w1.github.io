import { renderAst } from "/assets/js/content-renderer.js?v=20260824";
import { MutationGate, publicationTarget, shortCommit } from "/admin/j3w1ctl-core.js?v=20260825";
import { EXAMPLES } from "/admin/j3w1ctl-examples.js?v=20260825";
import { IMAGE_ACCEPT, IMAGE_LIMITS, generatedImageBytes, normalizePhotograph } from "/admin/j3w1ctl-images.js?v=20260825";

const TOKEN_KEY = "j3w1ctl.session";
const COLLECTIONS = ["writing", "books", "photography"];
const STATES = new Set(["locked", "authenticating", "authenticated", "loading", "clean", "modified", "local draft", "publishing", "deleting", "published", "conflict", "error", "offline"]);
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
  link.href = "/admin/j3w1ctl.css?v=20260825";
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
    const transaction = db.transaction("drafts", ["get", "list"].includes(mode) ? "readonly" : "readwrite");
    const store = transaction.objectStore("drafts");
    const request = mode === "put" ? store.put(value) : mode === "delete" ? store.delete(value) : mode === "clear" ? store.clear() : mode === "list" ? store.getAll() : store.get(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
};

const field = (label, name, { type = "text", value = "", options, required = false, maxLength, className = "", controlClassName = "", rows, help } = {}) => {
  const wrapper = node("label", `ctl-field${className ? ` ${className}` : ""}`);
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
  if (controlClassName) control.className = controlClassName;
  control.value = value ?? "";
  control.required = required;
  if (maxLength) control.maxLength = maxLength;
  if (rows && control instanceof HTMLTextAreaElement) control.rows = rows;
  wrapper.append(control);
  if (help) wrapper.append(node("small", "ctl-field-help", help));
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
    this.mutation = new MutationGate();
    this.deleteConfirmationInFlight = false;
    this.imageProcessingInFlight = false;
    this.repository = null;
    this.photoItems = [];
    this.localDrafts = [];
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
      const session = await this.request("/api/session");
      await this.unlock(session);
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
    this.status.append(node("span", "ctl-status-mode", "LOCKED"), node("span", "ctl-status-target", "GitHub repository"), node("span", "ctl-status-tail", "no session"));
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
    const [mode, target, tail] = this.status.children;
    mode.textContent = state.toUpperCase();
    mode.className = `ctl-status-mode${state === "offline" ? " ctl-offline" : state === "modified" ? " ctl-modified" : ""}`;
    const publication = publicationTarget(this.repository);
    target.textContent = publication.label;
    target.className = `ctl-status-target ${publication.live ? "is-live" : publication.mode === "SANDBOX" ? "is-sandbox" : ""}`;
    const editorSlug = this.form?.elements?.slug?.value?.trim();
    tail.textContent = message || `${this.collection}/${editorSlug || this.entry?.slug || "new"}`;
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
      try {
        const session = await this.request("/api/session");
        await this.unlock(session);
      } catch {
        sessionStorage.removeItem(TOKEN_KEY);
        this.token = "";
        this.renderLocked("The new session could not be validated.");
      }
    };
    window.addEventListener("message", this.messageHandler);
  }

  async unlock(session) {
    this.repository = session?.repository ?? null;
    this.setState("authenticated", "session unlocked");
    this.renderManager();
    await this.loadCollection();
  }

  renderManager() {
    const menu = node("div", "ctl-menu");
    [["New", () => this.newEntry()], ["Examples", () => this.showExamples()], ["Save draft", () => this.saveDraft()], ["Preview", () => this.preview()], ["Publish", () => this.publish()], ["Logout", () => this.logout()]].forEach(([label, action]) => { const button = node("button", "", label); button.type = "button"; button.dataset.action = label.toLowerCase().replace(" ", "-"); button.dataset.normalLabel = label; button.addEventListener("click", action); menu.append(button); });
    const forget = node("button", "", "Forget local drafts"); forget.type = "button"; forget.dataset.action = "forget-local-drafts"; forget.dataset.normalLabel = "Forget local drafts"; forget.addEventListener("click", () => this.forgetDrafts()); menu.append(forget);
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
    if (this.mutation.inFlight || this.imageProcessingInFlight) return;
    this.body.querySelectorAll("[data-buffer-pane]").forEach((pane) => pane.classList.toggle("is-mobile-active", pane.dataset.bufferPane === name));
    this.body.querySelectorAll("[data-buffer]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.buffer === name)));
  }

  async changeCollection(name) {
    if (this.mutation.inFlight || this.imageProcessingInFlight) return;
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
      this.localDrafts = (await draftOperation("list")).filter((draft) => draft.collection === this.collection);
      this.renderEntries();
      this.newEntry(false);
      this.setState("clean");
    } catch (error) { this.setState("error", error.message); }
  }

  renderEntries() {
    this.entryPane.replaceChildren(node("h3", "ctl-pane-title", `/content/${this.collection}`));
    const fresh = node("button", "ctl-entry", "+ new entry"); fresh.type = "button"; fresh.dataset.navigation = ""; fresh.addEventListener("click", () => this.newEntry()); this.entryPane.append(fresh);
    for (const entry of this.entries) {
      const button = node("button", "ctl-entry", entry.title); button.type = "button"; button.dataset.slug = entry.slug; button.dataset.navigation = ""; button.setAttribute("aria-pressed", String(this.entry?.slug === entry.slug)); button.addEventListener("click", () => this.selectEntry(entry.slug)); this.entryPane.append(button);
    }
    const remoteSlugs = new Set(this.entries.map(({ slug }) => slug));
    for (const draft of this.localDrafts.filter(({ value }) => !remoteSlugs.has(value.slug))) {
      const button = node("button", "ctl-entry ctl-entry-draft", `[draft] ${draft.value.title || draft.value.slug || "untitled"}`); button.type = "button"; button.dataset.navigation = ""; button.addEventListener("click", () => this.openLocalDraft(draft)); this.entryPane.append(button);
    }
  }

  openLocalDraft(draft) {
    if (this.mutation.inFlight || this.imageProcessingInFlight) return;
    this.conflicted = false; this.entry = { ...draft.value, persisted: false };
    this.renderEditor(draft.value, draft.files ?? []); this.renderEntries(); this.setState("local draft", "saved on this device"); this.showBuffer("editor");
  }

  async selectEntry(slug, { ignoreDraft = false } = {}) {
    if (this.mutation.inFlight || this.imageProcessingInFlight) return;
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
    if (this.mutation.inFlight) return;
    this.conflicted = false;
    this.entry = { slug: "", title: "", body: "", persisted: false };
    this.renderEditor(this.entry, []); this.previewPane.replaceChildren(node("h3", "ctl-pane-title", "preview"), node("p", "ctl-preview", "Preview is generated by the authenticated service.")); this.setState("clean");
    if (show) this.showBuffer("editor");
  }

  showExamples() {
    if (this.mutation.inFlight || this.imageProcessingInFlight) return;
    const dialog = node("dialog", "ctl-dialog ctl-example-dialog");
    const header = node("header", "window-titlebar"); header.append(node("span", "", `Load ${this.collection} example`));
    const body = node("div", "ctl-example-list");
    body.append(node("p", "ctl-dialog-note", "Examples populate a new local editor only. Nothing is saved or published automatically."));
    for (const example of EXAMPLES[this.collection]) {
      const button = node("button", "ctl-example", example.label); button.type = "button";
      button.addEventListener("click", () => { dialog.close(); this.loadExample(example); });
      body.append(button);
    }
    const actions = node("div", "ctl-actions"); const cancel = node("button", "ctl-button", "Cancel"); cancel.type = "button"; cancel.addEventListener("click", () => dialog.close()); actions.append(cancel);
    dialog.addEventListener("close", () => dialog.remove(), { once: true }); dialog.append(header, body, actions); document.body.append(dialog); dialog.showModal();
  }

  loadExample(example) {
    if (this.mutation.inFlight) return;
    this.conflicted = false;
    this.entry = { ...structuredClone(example), persisted: false };
    this.renderEditor(this.entry, []);
    this.previewPane.replaceChildren(node("h3", "ctl-pane-title", "preview"), node("p", "ctl-preview", "Preview is generated by the authenticated service."));
    this.setState("modified", "example loaded locally; not published");
    this.showBuffer("editor");
  }

  renderEditor(value, files = []) {
    const form = node("form", "ctl-form"); form.setAttribute("aria-label", `${this.collection} editor`); form.addEventListener("submit", (event) => event.preventDefault());
    form.append(field("Title", "title", { value: value.title, required: true, maxLength: 120 }), field("Slug (immutable after publish)", "slug", { value: value.slug, required: true, maxLength: 80 }));
    if (this.collection === "writing") form.append(field("Date", "date", { type: "date", value: value.date, required: true }), field("Summary", "summary", { type: "textarea", value: value.summary, required: true, maxLength: 500, rows: 4, controlClassName: "ctl-textarea-summary" }), field("Tags (comma separated)", "tags", { value: (value.tags ?? []).join(", ") }), field("Markdown", "body", { type: "textarea", value: value.body, required: true, rows: 16, controlClassName: "ctl-textarea-body" }));
    if (this.collection === "books") form.append(field("Author", "author", { value: value.author, required: true }), field("Year", "year", { type: "number", value: value.year, required: true }), field("Status", "status", { type: "select", value: value.status || "want-to-read", options: [["want-to-read", "Want to read"], ["reading", "Reading"], ["finished", "Finished"], ["abandoned", "Abandoned"]] }), field("Rating (0–5)", "rating", { type: "number", value: value.rating }), field("Started", "started", { type: "date", value: value.started }), field("Finished", "finished", { type: "date", value: value.finished }), field("Tags (comma separated)", "tags", { value: (value.tags ?? []).join(", ") }), field("Markdown notes", "body", { type: "textarea", value: value.body, rows: 16, controlClassName: "ctl-textarea-body" }));
    if (this.collection === "photography") {
      form.append(field("Date", "date", { type: "date", value: value.date, required: true }), field("Caption", "caption", { type: "textarea", value: value.caption, required: true, maxLength: 500, rows: 4, controlClassName: "ctl-textarea-summary" }), field("Location", "location", { value: value.location }), field("Camera", "camera", { value: value.camera }));
      this.photoItems = this.hydratePhotoItems(value.images ?? [], files);
      const picker = field("Select photographs", "photographs", { type: "file", className: "ctl-photo-picker", help: "JPG, JPEG, PNG, or WebP. j3w1ctl creates the full and thumbnail WebP files locally before publication." });
      this.photoPicker = picker.querySelector("input"); this.photoPicker.accept = IMAGE_ACCEPT; this.photoPicker.multiple = true; this.photoPicker.addEventListener("change", (event) => this.addPhotographs(event));
      this.photoList = node("div", "ctl-photo-list"); form.append(picker);
      if (value.photoHint) form.append(node("p", "ctl-photo-hint", value.photoHint));
      form.append(this.photoList); this.renderPhotoItems();
    }
    if (value.persisted || this.entry?.persisted) form.querySelector('[name="slug"]').readOnly = true;
    form.addEventListener("input", () => this.setState(navigator.onLine ? "modified" : "offline", navigator.onLine ? `${this.collection}/${form.elements.slug.value.trim() || "new"}` : "local editing only"));
    this.form = form; this.editorPane.replaceChildren(node("h3", "ctl-pane-title", `${this.collection}/${value.slug || "new"}`), form);
    this.syncActions();
  }

  hydratePhotoItems(images, files) {
    return images.map((image) => {
      const saved = files.find((pair) => pair.id === image.id) ?? {};
      const fullBlob = saved.full instanceof Blob ? saved.full : saved.full?.blob;
      const thumbnailBlob = saved.thumbnail instanceof Blob ? saved.thumbnail : saved.thumbnail?.blob;
      return {
        id: image.id,
        alt: image.alt ?? "",
        caption: image.caption ?? "",
        source: saved.source,
        full: fullBlob ? { ...(saved.fullInfo ?? {}), blob: fullBlob, size: fullBlob.size } : null,
        thumbnail: thumbnailBlob ? { ...(saved.thumbnailInfo ?? {}), blob: thumbnailBlob, size: thumbnailBlob.size } : null,
        existing: !fullBlob && !thumbnailBlob,
      };
    });
  }

  formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "unknown size";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  }

  renderPhotoItems() {
    if (!this.photoList) return;
    this.photoList.replaceChildren();
    if (!this.photoItems.length) this.photoList.append(node("p", "ctl-photo-empty", "No photographs selected. Originals stay local; only generated WebP pairs are sent when Publish is clicked."));
    this.photoItems.forEach((item, index) => {
      const row = node("fieldset", "ctl-photo-item"); row.dataset.imagePair = item.id; row.photoItem = item;
      row.append(node("legend", "", `${String(index + 1).padStart(2, "0")} · ${item.id}`));
      const source = item.source
        ? `${item.source.name}\n${item.source.format} · ${item.source.width}×${item.source.height} · ${this.formatBytes(item.source.size)}`
        : "Existing repository WebP pair";
      const normalized = item.full && item.thumbnail
        ? `→ ${item.id}.webp · ${item.full.width ?? "?"}×${item.full.height ?? "?"} · ${this.formatBytes(item.full.blob?.size ?? item.full.size)}\n→ ${item.id}-thumb.webp · ${item.thumbnail.width ?? "?"}×${item.thumbnail.height ?? "?"} · ${this.formatBytes(item.thumbnail.blob?.size ?? item.thumbnail.size)}`
        : `→ ${item.id}.webp + ${item.id}-thumb.webp retained`;
      row.append(node("pre", "ctl-photo-info", `${source}\n${normalized}`));
      row.append(field("Alt text", "imageAlt", { value: item.alt, required: true, maxLength: 500, help: "Describe the photograph for someone who cannot see it; a filename is not sufficient." }), field("Image caption", "imageCaption", { value: item.caption, maxLength: 500 }));
      const actions = node("div", "ctl-photo-actions");
      [["Move up", () => this.movePhotograph(index, -1), index === 0], ["Move down", () => this.movePhotograph(index, 1), index === this.photoItems.length - 1], ["Remove image", () => this.removePhotograph(index), false]].forEach(([label, action, disabled]) => {
        const button = node("button", `ctl-button${label === "Remove image" ? " ctl-button-danger" : ""}`, label); button.type = "button"; button.disabled = disabled; button.addEventListener("click", action); actions.append(button);
      });
      row.append(actions); this.photoList.append(row);
    });
    this.syncActions();
  }

  nextPhotoId(reserved = []) {
    const ids = new Set([...this.photoItems.map(({ id }) => id), ...reserved]);
    for (let index = 1; index <= IMAGE_LIMITS.count; index += 1) {
      const id = `image-${String(index).padStart(2, "0")}`;
      if (!ids.has(id)) return id;
    }
    throw new Error(`A photography entry may contain at most ${IMAGE_LIMITS.count} images.`);
  }

  async addPhotographs(event) {
    const selected = [...event.currentTarget.files];
    event.currentTarget.value = "";
    if (!selected.length || this.imageProcessingInFlight || this.mutation.inFlight) return;
    if (this.photoItems.length + selected.length > IMAGE_LIMITS.count) return this.setState("error", `Select at most ${IMAGE_LIMITS.count} photographs per entry.`);
    this.imageProcessingInFlight = true; this.form.setAttribute("aria-busy", "true"); this.setState("loading", `optimizing ${selected.length} photograph${selected.length === 1 ? "" : "s"} locally`); this.syncActions();
    try {
      const normalized = [];
      const reserved = [];
      for (const file of selected) {
        const id = this.nextPhotoId(reserved); reserved.push(id);
        const result = await normalizePhotograph(file);
        normalized.push({ id, alt: "", caption: "", source: result.source, full: result.full, thumbnail: result.thumbnail, existing: false });
      }
      if (generatedImageBytes([...this.photoItems, ...normalized]) > IMAGE_LIMITS.totalBytes) throw new Error("Generated photography files exceed the 28 MiB entry limit. Select fewer photographs.");
      this.photoItems.push(...normalized); this.renderPhotoItems(); this.setState("modified", `${normalized.length} photograph${normalized.length === 1 ? "" : "s"} optimized; add alt text`);
    } catch (error) {
      this.setState("error", error.message);
    } finally {
      this.imageProcessingInFlight = false; this.form.removeAttribute("aria-busy"); this.syncActions();
    }
  }

  syncPhotoInputs() {
    this.photoList?.querySelectorAll("[data-image-pair]").forEach((row) => {
      const item = row.photoItem;
      item.alt = row.querySelector('[name="imageAlt"]').value.trim();
      item.caption = row.querySelector('[name="imageCaption"]').value.trim();
    });
  }

  movePhotograph(index, delta) {
    if (this.mutation.inFlight) return;
    this.syncPhotoInputs();
    const target = index + delta;
    if (target < 0 || target >= this.photoItems.length) return;
    [this.photoItems[index], this.photoItems[target]] = [this.photoItems[target], this.photoItems[index]];
    this.renderPhotoItems(); this.setState("modified", "photography order changed");
  }

  removePhotograph(index) {
    if (this.mutation.inFlight) return;
    this.syncPhotoInputs(); this.photoItems.splice(index, 1); this.renderPhotoItems(); this.setState("modified", "photograph removed locally");
  }

  editorValue({ validate = false } = {}) {
    if (validate && !this.form.reportValidity()) throw new Error("Complete the required fields before continuing.");
    const data = Object.fromEntries(new FormData(this.form));
    const common = { title: data.title, slug: data.slug };
    if (this.collection === "writing") return { ...common, date: data.date, summary: data.summary, tags: normalizeTags(data.tags), body: data.body };
    if (this.collection === "books") return { ...common, author: data.author, year: Number(data.year), status: data.status, ...(data.rating ? { rating: Number(data.rating) } : {}), ...(data.started ? { started: data.started } : {}), ...(data.finished ? { finished: data.finished } : {}), tags: normalizeTags(data.tags), body: data.body };
    this.syncPhotoInputs();
    const images = []; const files = [];
    for (const item of this.photoItems) {
      if (validate && !item.alt) throw new Error(`Add meaningful alt text for ${item.id} before publication.`);
      if (validate && !item.existing && (!(item.full?.blob instanceof Blob) || !(item.thumbnail?.blob instanceof Blob))) throw new Error(`${item.id} is missing its generated WebP pair.`);
      images.push({ id: item.id, file: `${item.id}.webp`, thumbnail: `${item.id}-thumb.webp`, alt: item.alt, ...(item.caption ? { caption: item.caption } : {}) });
      files.push({
        id: item.id,
        full: item.full?.blob,
        thumbnail: item.thumbnail?.blob,
        source: item.source,
        fullInfo: item.full ? { width: item.full.width, height: item.full.height, size: item.full.blob?.size ?? item.full.size, quality: item.full.quality } : undefined,
        thumbnailInfo: item.thumbnail ? { width: item.thumbnail.width, height: item.thumbnail.height, size: item.thumbnail.blob?.size ?? item.thumbnail.size, quality: item.thumbnail.quality } : undefined,
      });
    }
    return { ...common, date: data.date, caption: data.caption, ...(data.location ? { location: data.location } : {}), ...(data.camera ? { camera: data.camera } : {}), images, body: "", files };
  }

  draftKey(value = this.editorValue()) { return `${this.collection}/${value.slug || "new"}`; }

  async saveDraft() {
    if (this.mutation.inFlight) return;
    const value = this.editorValue(); const files = value.files ?? []; delete value.files;
    await this.saveDraftSnapshot(value, files);
    this.localDrafts = (await draftOperation("list")).filter((draft) => draft.collection === this.collection); this.renderEntries();
    this.setState("local draft", "saved on this device");
  }

  async saveDraftSnapshot(value, files = []) {
    await draftOperation("put", { key: this.draftKey(value), collection: this.collection, value, files });
  }

  async forgetDrafts() {
    if (this.mutation.inFlight) return;
    if (!await this.confirm("Forget local drafts?", "This permanently removes every local j3w1ctl draft and selected photograph blob from this browser.")) return;
    await draftOperation("clear"); this.localDrafts = []; this.renderEntries(); this.setState(this.entry?.persisted ? "clean" : "authenticated", "local drafts removed");
  }

  async preview() {
    if (this.mutation.inFlight || this.imageProcessingInFlight) return;
    if (!navigator.onLine) return this.setState("offline", "preview requires the service");
    if (matchMedia("(min-width: 768px) and (max-width: 1100px)").matches && this.previewPane.classList.contains("is-visible")) {
      this.previewPane.classList.remove("is-visible");
      return this.setState(this.entry ? "modified" : "authenticated", "preview hidden");
    }
    let value;
    try { value = this.editorValue({ validate: true }); } catch (error) { return this.setState("error", error.message); }
    const body = value.body; delete value.body; delete value.files;
    this.setState("loading", "validating preview");
    try {
      const result = await this.request(`/api/preview/${this.collection}`, { method: "POST", body: JSON.stringify({ metadata: value, body }) });
      this.previewPane.replaceChildren(node("h3", "ctl-pane-title", `preview — ${value.title}`)); const rendered = node("div", "ctl-preview"); renderAst(result.blocks, rendered); this.previewPane.append(rendered); this.previewPane.classList.add("is-visible"); this.setState("modified", "preview validated"); this.showBuffer("preview");
    } catch (error) { this.setState("error", error.message); }
  }

  async publish() {
    if (this.mutation.inFlight) return;
    if (!navigator.onLine) return this.setState("offline", "publication requires the service");
    if (this.imageProcessingInFlight) return this.setState("loading", "wait for photograph optimization to finish");
    let snapshot;
    try { snapshot = this.editorValue({ validate: true }); } catch (error) { return this.setState("error", error.message); }
    const files = snapshot.files ?? []; delete snapshot.files; const markdownBody = snapshot.body; delete snapshot.body;
    const persisted = Boolean(this.entry?.persisted); const path = persisted ? `/api/content/${this.collection}/${encodeURIComponent(this.entry.slug)}` : `/api/content/${this.collection}`;
    const options = { method: persisted ? "PUT" : "POST", headers: persisted ? { "If-Match": `"${this.entry.version}"` } : { "If-None-Match": "*" } };
    if (this.collection === "photography") { const form = new FormData(); form.append("metadata", JSON.stringify(snapshot)); for (const pair of files) { if (pair.full instanceof Blob) form.append(`full.${pair.id}`, pair.full, `${pair.id}.webp`); if (pair.thumbnail instanceof Blob) form.append(`thumbnail.${pair.id}`, pair.thumbnail, `${pair.id}-thumb.webp`); } options.body = form; }
    else { options.body = JSON.stringify({ metadata: snapshot, body: markdownBody }); }
    if (!this.beginMutation("publish", snapshot)) return;
    let result; let failure;
    try { result = await this.request(path, options); } catch (error) { failure = error; } finally { this.endMutation(); }
    if (failure) {
      if (failure.code === "content_conflict") {
        await this.saveDraftSnapshot({ ...snapshot, body: markdownBody }, files); this.conflicted = true; this.conflictKey = this.draftKey(snapshot); this.setState("conflict", "remote changed; local draft preserved"); this.renderConflict();
      } else this.setState("error", failure.message);
      return;
    }
    await draftOperation("delete", this.draftKey(snapshot)); this.conflicted = false; this.conflictKey = null;
    await this.loadCollection(); await this.selectEntry(snapshot.slug); this.setState("published", shortCommit(result.commitSha));
  }

  renderConflict() {
    const actions = node("div", "ctl-actions"); const reload = node("button", "ctl-button", "Reload remote"); reload.type = "button"; reload.addEventListener("click", () => this.selectEntry(this.entry.slug, { ignoreDraft: true })); const keep = node("button", "ctl-button ctl-button-primary", "Keep local draft"); keep.type = "button"; keep.addEventListener("click", () => this.setState("local draft", "publication disabled until remote is reloaded")); actions.append(reload, keep); this.editorPane.append(actions);
  }

  async deleteEntry() {
    if (this.mutation.inFlight || this.deleteConfirmationInFlight || !this.entry?.persisted || !navigator.onLine) return;
    this.deleteConfirmationInFlight = true;
    let confirmed;
    try {
      const paths = [`content/${this.collection}/${this.entry.slug}.md`];
      if (this.collection === "photography") for (const image of this.entry.images ?? []) paths.push(image.src.replace(/^\//, ""), image.thumbnailSrc.replace(/^\//, ""));
      confirmed = await this.confirm(`Delete ${this.entry.title}?`, `One commit will delete:\n${paths.join("\n")}`);
    } finally {
      this.deleteConfirmationInFlight = false;
    }
    if (!confirmed || this.mutation.inFlight) return;
    const snapshot = { collection: this.collection, slug: this.entry.slug, title: this.entry.title, version: this.entry.version };
    if (!this.beginMutation("delete", snapshot)) return;
    let result; let failure;
    try {
      result = await this.request(`/api/content/${snapshot.collection}/${encodeURIComponent(snapshot.slug)}`, { method: "DELETE", headers: { "If-Match": `"${snapshot.version}"` } });
    } catch (error) { failure = error; } finally { this.endMutation(); }
    if (failure) {
      if (failure.code === "content_conflict") {
        const value = this.editorValue(); const files = value.files ?? []; delete value.files;
        await this.saveDraftSnapshot(value, files); this.conflicted = true; this.conflictKey = `${snapshot.collection}/${snapshot.slug}`; this.setState("conflict", "remote changed; local draft preserved"); this.renderConflict();
      } else this.setState("error", failure.message);
      return;
    }
    await draftOperation("delete", `${snapshot.collection}/${snapshot.slug}`); await this.loadCollection(); this.setState("published", shortCommit(result.commitSha));
  }

  beginMutation(action, value) {
    if (!this.mutation.enter(action)) return false;
    this.setMutationLocked(true);
    const entryPath = `${this.collection}/${value.slug || "new"}`;
    this.setState(action === "delete" ? "deleting" : "publishing", `${entryPath} · controls locked`);
    return true;
  }

  endMutation() {
    this.mutation.leave();
    this.setMutationLocked(false);
    this.syncActions();
  }

  setMutationLocked(locked) {
    if (locked) { this.overlay?.setAttribute("aria-busy", "true"); this.form?.setAttribute("aria-busy", "true"); }
    else { this.overlay?.removeAttribute("aria-busy"); this.form?.removeAttribute("aria-busy"); }
    this.overlay?.classList.toggle("is-mutation-locked", locked);
    const controls = this.overlay?.querySelectorAll("button,input,select,textarea") ?? [];
    controls.forEach((control) => {
      if (locked) {
        if (!control.hasAttribute("data-pre-mutation-disabled")) {
          control.dataset.preMutationDisabled = String(control.disabled);
          control.disabled = true;
        }
      } else if (control.hasAttribute("data-pre-mutation-disabled")) {
        control.disabled = control.dataset.preMutationDisabled === "true";
        delete control.dataset.preMutationDisabled;
      }
    });
  }

  confirm(title, message) {
    return new Promise((resolve) => {
      const dialog = node("dialog", "ctl-dialog"); const header = node("header", "window-titlebar"); header.append(node("span", "", title)); const body = node("div", "ctl-dialog-body", message); const actions = node("div", "ctl-actions"); const cancel = node("button", "ctl-button", "Cancel"); const confirm = node("button", "ctl-button ctl-button-danger", "Confirm"); [cancel, confirm].forEach((button) => { button.type = "button"; actions.append(button); }); cancel.addEventListener("click", () => { dialog.close(); resolve(false); }); confirm.addEventListener("click", () => { dialog.close(); resolve(true); }); dialog.addEventListener("close", () => dialog.remove(), { once: true }); dialog.append(header, body, actions); document.body.append(dialog); dialog.showModal();
    });
  }

  async logout() {
    if (this.mutation.inFlight) return;
    const token = this.token; sessionStorage.removeItem(TOKEN_KEY); this.token = ""; this.repository = null; this.renderLocked("Signed out. Local drafts remain on this device.");
    if (token) fetch(`${this.apiBase}/api/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }

  syncActions() {
    if (!this.body) return;
    const mutating = this.mutation.inFlight; const offline = !navigator.onLine || this.state === "offline"; const conflict = this.conflicted || this.state === "conflict"; const processing = this.imageProcessingInFlight;
    const publishButton = this.body.querySelector('[data-action="publish"]');
    if (publishButton) { publishButton.disabled = mutating || processing || offline || conflict; publishButton.textContent = mutating && this.mutation.action === "publish" ? "Publishing…" : publishButton.dataset.normalLabel; }
    const previewButton = this.body.querySelector('[data-action="preview"]'); if (previewButton) previewButton.disabled = mutating || processing || offline;
    ["new", "examples", "save-draft", "forget-local-drafts", "logout"].forEach((action) => { const button = this.body.querySelector(`[data-action="${action}"]`); if (button) button.disabled = mutating || processing; });
    this.body.querySelectorAll("[data-navigation],.ctl-collection,.ctl-mobile-buffers button").forEach((button) => { button.disabled = mutating || processing; });
    let deleteButton = this.body.querySelector('[data-action="delete"]');
    if (this.entry?.persisted && !deleteButton) { deleteButton = node("button", "", "Delete"); deleteButton.type = "button"; deleteButton.dataset.action = "delete"; deleteButton.dataset.normalLabel = "Delete"; deleteButton.addEventListener("click", () => this.deleteEntry()); this.body.querySelector(".ctl-menu")?.append(deleteButton); }
    if (deleteButton) { deleteButton.disabled = !this.entry?.persisted || offline || mutating || processing; deleteButton.textContent = mutating && this.mutation.action === "delete" ? "Deleting…" : deleteButton.dataset.normalLabel; }
    if (mutating) this.setMutationLocked(true);
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
