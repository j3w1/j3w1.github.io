/* Shared session and upload-batch store, backed by Neon Postgres.

   The surface is a small keyed store with per-entry expiry — sessions and
   upload batches, nothing else — so it maps onto one table rather than a schema.
   Expiry is enforced in the read path (`expires_at > now()`) rather than by a
   background job, so a lapsed row can never be observed even if the hourly
   sweep is late or has not run.

   Neon's serverless driver speaks HTTP, so there is no connection pool to
   exhaust across Vercel Function invocations. */

import { neon } from "@neondatabase/serverless";
import { dependencyUnavailable } from "./errors.js";

const storeUnavailable = () => dependencyUnavailable("session_store_unavailable", "The shared session store is unavailable.");

export const KV_TABLE = "j3w1ctl_kv";

export const SCHEMA_STATEMENTS = Object.freeze([
  `create table if not exists ${KV_TABLE} (
     key text primary key,
     value jsonb not null,
     expires_at timestamptz not null
   )`,
  `create index if not exists ${KV_TABLE}_expires_at_idx on ${KV_TABLE} (expires_at)`,
]);

/* Redis glob to SQL LIKE. The literal wildcards have to be escaped first, or a
   key containing % would silently widen the match. */
const globToLike = (pattern) =>
  String(pattern ?? "*")
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\%")
    .replaceAll("_", "\_")
    .replaceAll("*", "%")
    .replaceAll("?", "_");

const unavailableStore = Object.freeze({
  get: async () => { throw storeUnavailable(); },
  set: async () => { throw storeUnavailable(); },
  setIfAbsent: async () => { throw storeUnavailable(); },
  delete: async () => { throw storeUnavailable(); },
  scan: async () => { throw storeUnavailable(); },
  ping: async () => { throw storeUnavailable(); },
  migrate: async () => { throw storeUnavailable(); },
});

export const createPostgresStore = (config, { sqlImplementation } = {}) => {
  if (!config.databaseUrl && !sqlImplementation) return unavailableStore;

  const sql = sqlImplementation ?? neon(config.databaseUrl);
  const call = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      if (error?.statusCode) throw error;
      throw storeUnavailable();
    }
  };

  return Object.freeze({
    get: async (key) => {
      const rows = await call(() => sql`
        select value from ${sql.unsafe(KV_TABLE)}
        where key = ${key} and expires_at > now()
      `);
      return rows[0]?.value ?? null;
    },

    set: async (key, value, ttlSeconds) => {
      await call(() => sql`
        insert into ${sql.unsafe(KV_TABLE)} (key, value, expires_at)
        values (${key}, ${JSON.stringify(value)}::jsonb, now() + make_interval(secs => ${ttlSeconds}))
        on conflict (key) do update
          set value = excluded.value, expires_at = excluded.expires_at
      `);
      return "OK";
    },

    /* An expired row must count as absent, which is why the conflict branch
       updates only when the existing entry has already lapsed. */
    setIfAbsent: async (key, value, ttlSeconds) => {
      const rows = await call(() => sql`
        insert into ${sql.unsafe(KV_TABLE)} (key, value, expires_at)
        values (${key}, ${JSON.stringify(value)}::jsonb, now() + make_interval(secs => ${ttlSeconds}))
        on conflict (key) do update
          set value = excluded.value, expires_at = excluded.expires_at
          where ${sql.unsafe(KV_TABLE)}.expires_at <= now()
        returning key
      `);
      return rows.length > 0;
    },

    delete: async (...keys) => {
      if (!keys.length) return 0;
      const rows = await call(() => sql`
        delete from ${sql.unsafe(KV_TABLE)} where key = any(${keys}) returning key
      `);
      return rows.length;
    },

    /* Keyset pagination standing in for Redis SCAN: the cursor is the last key
       returned, and "0" means both "start here" and "nothing left". */
    scan: async (cursor, { match = "*", count = 100 } = {}) => {
      const after = cursor && cursor !== "0" ? String(cursor) : "";
      const rows = await call(() => sql`
        select key from ${sql.unsafe(KV_TABLE)}
        where key > ${after} and expires_at > now() and key like ${globToLike(match)} escape '\'
        order by key
        limit ${count}
      `);
      const keys = rows.map((row) => row.key);
      const next = keys.length < count ? "0" : keys[keys.length - 1];
      return [next, keys];
    },

    ping: async () => {
      await call(() => sql`select 1`);
      return "PONG";
    },

    /* Idempotent, so a cold Function can call it without coordination. */
    migrate: async () => {
      for (const statement of SCHEMA_STATEMENTS) await call(() => sql.query(statement));
      return true;
    },

    sweepExpired: async () => {
      const rows = await call(() => sql`
        delete from ${sql.unsafe(KV_TABLE)} where expires_at <= now() returning key
      `);
      return rows.length;
    },
  });
};
