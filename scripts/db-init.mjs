import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Local dev uses a persistent D1 SQLite file under .wrangler/state.
 * Running schema.sql with CREATE TABLE IF NOT EXISTS will NOT add new columns.
 *
 * This script:
 *  1) applies schema.sql (CREATE TABLE IF NOT EXISTS)
 *  2) applies migrations in ./migrations ONLY when needed
 *
 * Why the extra logic?
 * - Local dev often starts from schema.sql (which already includes the latest columns)
 * - Running old migrations after that can spam "duplicate column" / "already exists" errors
 *
 * We keep local dev clean by:
 * - Tracking applied migrations in schema_migrations
 * - If we detect the DB is already on the latest schema (e.g. Arabic columns exist),
 *   we mark all migrations as applied without executing them.
 */

const args = new Set(process.argv.slice(2));
const isRemote = args.has('--remote');
const dbName = 'scheduler-db';

function runWranglerExecute({ file, command }) {
  const base = ['wrangler', 'd1', 'execute', dbName];
  if (!isRemote) base.push('--local');
  if (file) base.push('--file', file);
  if (command) base.push('--command', command);

  const res = spawnSync(base[0], base.slice(1), { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`wrangler d1 execute failed (status ${res.status})`);
  }
}

function extractJsonFromWrangler(stdout) {
  if (!stdout) return null;
  const s = String(stdout).trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  const json = s.slice(start, end + 1);
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function runWranglerExecuteCapture(command) {
  const base = ['wrangler', 'd1', 'execute', dbName];
  if (!isRemote) base.push('--local');
  base.push('--command', command);

  const res = spawnSync(base[0], base.slice(1), { encoding: 'utf8' });
  const parsed = extractJsonFromWrangler(res.stdout);
  if (res.status !== 0) {
    const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
    throw new Error(combined.trim() || `wrangler d1 execute failed (status ${res.status})`);
  }
  return parsed;
}

function runWranglerExecuteAllowingAlreadyApplied({ file, command }) {
  const base = ['wrangler', 'd1', 'execute', dbName];
  if (!isRemote) base.push('--local');
  if (file) base.push('--file', file);
  if (command) base.push('--command', command);

  const res = spawnSync(base[0], base.slice(1), { encoding: 'utf8' });
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const combined = `${stdout}\n${stderr}`;

  if (res.status === 0) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    return { applied: true };
  }

  const alreadyApplied =
    combined.includes('duplicate column name') ||
    combined.includes('already exists') ||
    combined.includes('UNIQUE constraint failed');

  if (alreadyApplied) {
    // Avoid noisy logs for local dev.
    return { applied: false, alreadyApplied: true };
  }

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  throw new Error(`wrangler d1 execute failed (status ${res.status})`);
}

// 1) Base schema
runWranglerExecute({ file: './schema.sql' });

// 2) Migrations
const migrationsDir = join(process.cwd(), 'migrations');
if (existsSync(migrationsDir)) {
  // Track applied migrations.
  runWranglerExecute({
    command: `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')));`
  });

  // Heuristic: if Arabic columns exist, schema.sql already reflects the latest schema.
  // For local dev, we mark all migrations as applied to avoid "duplicate column" spam.
  let dbLooksUpToDate = false;
  try {
    const info = runWranglerExecuteCapture(`PRAGMA table_info(event_types);`) || [];
    const results = info?.[0]?.results || info?.results || [];
    const cols = new Set(results.map((r) => r?.name).filter(Boolean));
    dbLooksUpToDate = cols.has('name_ar') && cols.has('host_name_ar');
  } catch {
    dbLooksUpToDate = false;
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();

  if (dbLooksUpToDate && !isRemote) {
    for (const f of files) {
      runWranglerExecuteAllowingAlreadyApplied({
        command: `INSERT OR IGNORE INTO schema_migrations(name) VALUES (${JSON.stringify(f)});`
      });
    }
    console.log('[db-init] Local DB already up-to-date; migrations marked as applied.');
  } else {
    for (const f of files) {
      const rows = runWranglerExecuteCapture(
        `SELECT name FROM schema_migrations WHERE name=${JSON.stringify(f)} LIMIT 1;`
      );
      const existing = (rows?.[0]?.results || rows?.results || []).length > 0;
      if (existing) continue;

      const res = runWranglerExecuteAllowingAlreadyApplied({ file: `./migrations/${f}` });
      runWranglerExecuteAllowingAlreadyApplied({
        command: `INSERT OR IGNORE INTO schema_migrations(name) VALUES (${JSON.stringify(f)});`
      });
      if (res?.alreadyApplied) {
        console.log(`[db-init] Migration ${f} already applied; recorded.`);
      }
    }
  }
}

console.log(`[db-init] Database initialized (${isRemote ? 'remote' : 'local'}).`);
