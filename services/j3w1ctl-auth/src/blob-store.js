import { del, get, list, put } from "@vercel/blob";
import { dependencyUnavailable } from "./errors.js";

const blobUnavailable = () => dependencyUnavailable("blob_store_unavailable", "The private upload store is unavailable.");

export const createBlobStore = (config, implementations = {}) => {
  const listImpl = implementations.listImpl ?? list;
  const getImpl = implementations.getImpl ?? get;
  const deleteImpl = implementations.deleteImpl ?? del;
  const putImpl = implementations.putImpl ?? put;
  const token = config.blobToken;
  const call = async (operation) => {
    if (!token) throw blobUnavailable();
    try {
      return await operation();
    } catch (error) {
      if (error?.statusCode) throw error;
      throw blobUnavailable();
    }
  };

  const listPrefix = async (prefix, { maximumItems = 1_000 } = {}) => {
    const blobs = [];
    let cursor;
    do {
      const limit = Math.min(1_000, maximumItems - blobs.length);
      if (limit <= 0) break;
      const page = await call(() => listImpl({ prefix, limit, ...(cursor ? { cursor } : {}), token }));
      blobs.push(...(page?.blobs ?? []));
      cursor = page?.hasMore ? page.cursor : undefined;
    } while (cursor && blobs.length < maximumItems);
    return blobs.slice(0, maximumItems);
  };

  const read = async (pathname) => {
    const result = await call(() => getImpl(pathname, { access: "private", token }));
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    return { ...result.blob, bytes };
  };

  const remove = async (pathnames) => {
    const targets = [...new Set(pathnames)].filter(Boolean);
    if (!targets.length) return;
    await call(() => deleteImpl(targets, { token }));
  };

  const probe = async (pathname, content) => {
    await call(() => putImpl(pathname, content, { access: "private", token, addRandomSuffix: false, allowOverwrite: false }));
    try {
      const result = await read(pathname);
      return Boolean(result && result.bytes.equals(Buffer.from(content)));
    } finally {
      await remove([pathname]);
    }
  };

  return Object.freeze({ listPrefix, read, remove, probe });
};
