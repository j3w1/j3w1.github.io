#!/usr/bin/env node
/* Applies the store schema. Idempotent, so it is safe to re-run and safe to
   race: every statement is CREATE ... IF NOT EXISTS.

   Run against a specific environment with `vercel env pull` first, or set
   DATABASE_URL directly. */

import { loadConfig } from "../src/config.js";
import { createPostgresStore, KV_TABLE, SCHEMA_STATEMENTS } from "../src/store.js";

const config = loadConfig(process.env);

if (!config.databaseUrl) {
  console.error("DATABASE_URL is not set; nothing to migrate.");
  process.exit(1);
}

const store = createPostgresStore(config);

try {
  await store.migrate();
  await store.ping();
  const swept = await store.sweepExpired();
  console.log(JSON.stringify({
    ok: true,
    table: KV_TABLE,
    statements: SCHEMA_STATEMENTS.length,
    sweptExpiredRows: swept,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error?.code ?? "migration_failed", message: error?.message }, null, 2));
  process.exit(1);
}
