/**
 * Kết nối CSDL SQLite dùng module có sẵn của Node (node:sqlite) -
 * không cần cài MySQL/SQL Server, chạy được trên Windows / macOS / Linux.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_FILE = path.resolve(BACKEND_ROOT, '..', 'database', 'schema.sql');

function resolveDbPath() {
  const p = process.env.DB_PATH || './data/coffee.db';
  if (p === ':memory:') return p;
  const abs = path.isAbsolute(p) ? p : path.resolve(BACKEND_ROOT, p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

let db;

function getDb() {
  if (!db) {
    db = new DatabaseSync(resolveDbPath());
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  }
  return db;
}

/** Chạy fn trong 1 transaction; lỗi -> rollback toàn bộ. */
function transaction(fn) {
  const conn = getDb();
  conn.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(conn);
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

const all = (sql, ...params) => getDb().prepare(sql).all(...params);
const get = (sql, ...params) => getDb().prepare(sql).get(...params);
const run = (sql, ...params) => getDb().prepare(sql).run(...params);

function closeDb() {
  if (db) { db.close(); db = undefined; }
}

module.exports = { getDb, transaction, all, get, run, closeDb, resolveDbPath };
