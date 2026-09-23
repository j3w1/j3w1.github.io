/* j3w1ctl's local drafts: an IndexedDB store in this browser only. Drafts never
   leave the machine until Publish; one connection per operation keeps no
   handle open between edits. */

const openDraftDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open("j3w1ctl", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "key" });
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve(request.result);
});

/* mode: "get" | "list" | "put" | "delete" | "clear" */
export const draftOperation = async (mode, value) => {
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
