import { Redis } from "@upstash/redis";
import { dependencyUnavailable } from "./errors.js";

const storeUnavailable = () => dependencyUnavailable("session_store_unavailable", "The shared session store is unavailable.");

const parseStored = (value) => {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const createRedisStore = (config, { RedisImplementation = Redis } = {}) => {
  if (!config.redisUrl || !config.redisToken) {
    return Object.freeze({
      get: async () => { throw storeUnavailable(); },
      set: async () => { throw storeUnavailable(); },
      setIfAbsent: async () => { throw storeUnavailable(); },
      delete: async () => { throw storeUnavailable(); },
      scan: async () => { throw storeUnavailable(); },
      ping: async () => { throw storeUnavailable(); },
    });
  }

  const redis = new RedisImplementation({
    url: config.redisUrl,
    token: config.redisToken,
    automaticDeserialization: false,
    signal: () => AbortSignal.timeout(5_000),
  });
  const call = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      if (error?.statusCode) throw error;
      throw storeUnavailable();
    }
  };

  return Object.freeze({
    get: async (key) => parseStored(await call(() => redis.get(key))),
    set: async (key, value, ttlSeconds) => call(() => redis.set(key, JSON.stringify(value), { ex: ttlSeconds })),
    setIfAbsent: async (key, value, ttlSeconds) => (await call(() => redis.set(key, JSON.stringify(value), { ex: ttlSeconds, nx: true }))) === "OK",
    delete: async (...keys) => keys.length ? call(() => redis.del(...keys)) : 0,
    scan: async (cursor, options) => call(() => redis.scan(cursor, options)),
    ping: async () => call(() => redis.ping()),
  });
};
