// Vivix Human — 数据层（node:sqlite）
// 主库 human.sqlite：users（仅内置本地账号）+ settings（KV）。
// 租户库 tenant-<uid>.sqlite：settings + 数字人三表（dh_personas / dh_images / dh_history）。
// 无登录系统：ensureLocalUser() 建一个 username='local'、role='admin' 的内置账号，
// password_hash='*'（不含 ':'）→ verifyPassword 永远失败 = 可进但永不可登（不是后门密码）。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// 数据目录：DATA_DIR 环境变量优先（Docker/fpk 挂载卷），默认 <项目根>/data
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

// better-sqlite3 风格的打开：journal/外键/忙等三件套 + d.transaction 兼容包装
function openDatabase(file) {
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode=DELETE');
  d.exec('PRAGMA foreign_keys=ON');
  d.exec('PRAGMA busy_timeout=5000');
  // node:sqlite 的 transaction 是方法调用；补一个 better-sqlite3 形状的属性以兼容习惯写法
  d.transaction = (fn) => (...args) => {
    d.exec('BEGIN');
    try { const r = fn(...args); d.exec('COMMIT'); return r; }
    catch (e) { d.exec('ROLLBACK'); throw e; }
  };
  return d;
}

const db = openDatabase(path.join(dataDir, 'human.sqlite'));

// ---------- 主库 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  allowed_pages TEXT NOT NULL DEFAULT '[]',
  allowed_tabs TEXT NOT NULL DEFAULT '{}',
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);

// ---------- 租户库 ----------
const tenantDbs = new Map();
function tenantDbFile(uid) { return path.join(dataDir, `tenant-${uid}.sqlite`); }

function initTenantSchema(d) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS dh_personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '数字人',
    type TEXT NOT NULL DEFAULT '女友',
    api_base TEXT NOT NULL DEFAULT 'https://api.vivix.ai',
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT 'vivix-a1-stream',
    voice_id TEXT NOT NULL DEFAULT 'longanhuan_v3.6',
    public_base TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    persona TEXT NOT NULL DEFAULT '{}',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS dh_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    persona_id INTEGER NOT NULL,
    file TEXT NOT NULL DEFAULT '', orig_name TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL DEFAULT 'image/png', size INTEGER NOT NULL DEFAULT 0,
    storage_path TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS dh_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    persona_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    audio_file TEXT NOT NULL DEFAULT '',
    ts TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_dh_history ON dh_history(persona_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_dh_images ON dh_images(persona_id, sort);
  `);
}

function getTenantDb(uid) {
  const n = Number(uid);
  if (!Number.isInteger(n) || n <= 0) throw new Error('非法用户 ID');
  let d = tenantDbs.get(n);
  if (!d) {
    d = openDatabase(tenantDbFile(n));
    initTenantSchema(d);
    tenantDbs.set(n, d);
  }
  return d;
}

// 句柄 → uid（主库返回 null）
function tenantIdOf(d) {
  for (const [uid, handle] of tenantDbs) if (handle === d) return uid;
  return null;
}

// ---------- settings KV（双签名：主库字符串键 / 显式库句柄） ----------
function getSetting(a, b, c) {
  const d = typeof a === 'string' ? db : a;
  const key = typeof a === 'string' ? a : b;
  const def = typeof a === 'string' ? b : c;
  const row = d.prepare('SELECT value FROM settings WHERE key=?').get(key);
  if (!row) return def;
  try { return JSON.parse(row.value); } catch { return row.value; }
}
function setSetting(a, b, c) {
  const d = typeof a === 'string' ? db : a;
  const key = typeof a === 'string' ? a : b;
  const val = typeof a === 'string' ? b : c;
  d.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(val));
}

// ---------- 内置本地账号（免登录的唯一实现点） ----------
const LOCAL_USERNAME = 'local';
let localUserCache = null;

function localUserRow(id) {
  const u = db.prepare('SELECT id, username, role, display_name, allowed_pages, allowed_tabs FROM users WHERE id=?').get(id);
  let tabs = {};
  try { tabs = JSON.parse(u.allowed_tabs || '{}') || {}; } catch { tabs = {}; }
  return { ...u, allowed_pages: [], allowed_tabs: tabs };
}

function ensureLocalUser() {
  if (localUserCache) return localUserCache;
  const row = db.prepare('SELECT id FROM users WHERE username=?').get(LOCAL_USERNAME);
  if (row) {
    db.prepare("UPDATE users SET role='admin', allowed_pages='[]', allowed_tabs='{}' WHERE id=?").run(row.id);
    localUserCache = localUserRow(row.id);
    return localUserCache;
  }
  const res = db.prepare("INSERT INTO users(username,password_hash,role,allowed_pages,allowed_tabs,display_name) VALUES(?,'*','admin','[]','{}','本地用户')").run(LOCAL_USERNAME);
  localUserCache = localUserRow(res.lastInsertRowid);
  return localUserCache;
}

module.exports = { db, dataDir, getSetting, setSetting, getTenantDb, tenantIdOf, ensureLocalUser };
