export const createMemoryStore = ({ now = () => Math.floor(Date.now() / 1000), unavailable = false } = {}) => {
  const entries = new Map();
  const alive = (key) => {
    const entry = entries.get(key);
    if (entry && entry.expiresAt <= now()) entries.delete(key);
    return entries.get(key);
  };
  const assertAvailable = () => {
    if (unavailable) throw Object.assign(new Error("unavailable"), { statusCode: 503, code: "session_store_unavailable" });
  };
  return {
    entries,
    async get(key) { assertAvailable(); return structuredClone(alive(key)?.value ?? null); },
    async set(key, value, ttlSeconds) { assertAvailable(); entries.set(key, { value: structuredClone(value), expiresAt: now() + ttlSeconds }); return "OK"; },
    async setIfAbsent(key, value, ttlSeconds) {
      assertAvailable();
      if (alive(key)) return false;
      entries.set(key, { value: structuredClone(value), expiresAt: now() + ttlSeconds });
      return true;
    },
    async delete(...keys) { assertAvailable(); return keys.reduce((count, key) => count + Number(entries.delete(key)), 0); },
    async scan(_cursor, { match }) {
      assertAvailable();
      const prefix = match.endsWith("*") ? match.slice(0, -1) : match;
      return ["0", [...entries.keys()].filter((key) => alive(key) && key.startsWith(prefix))];
    },
    async ping() { assertAvailable(); return "PONG"; },
  };
};

export const testProductionEnvironment = Object.freeze({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  CMS_SITE_ORIGIN: "https://j3w1.github.io",
  CMS_ALLOWED_GITHUB_LOGIN: "j3w1",
  CMS_ALLOWED_GITHUB_USER_ID: "42",
  CMS_SESSION_SECRET: "a sufficiently long test-only session secret",
  GITHUB_APP_ID: "1",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "test-only-oauth-secret",
  GITHUB_PRIVATE_KEY_BASE64: "test-only-key",
  GITHUB_CALLBACK_URL: "https://cms.example/auth/github/callback",
  GITHUB_API_VERSION: "2026-03-10",
  KV_REST_API_URL: "https://test-only.upstash.invalid",
  KV_REST_API_TOKEN: "test-only-redis-token",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test-only",
  CRON_SECRET: "test-only-cron-secret-at-least-16",
});
