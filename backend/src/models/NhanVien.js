/**
 * Model Nhân viên: truy vấn bảng employees + băm/kiểm tra mật khẩu (scrypt).
 */
const crypto = require('crypto');
const { all, get, run } = require('../config/db');

const ROLES = {
  admin: 'Quản trị',
  manager: 'Quản lý',
  cashier: 'Thu ngân',
  barista: 'Pha chế',
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === test.length && crypto.timingSafeEqual(expected, test);
}

const PUBLIC_COLS = 'id, full_name, username, role, phone, hourly_wage, active, created_at';

const NhanVien = {
  ROLES,
  hashPassword,
  verifyPassword,

  findAll() {
    return all(`SELECT ${PUBLIC_COLS} FROM employees ORDER BY active DESC, id`);
  },

  findById(id) {
    return get(`SELECT ${PUBLIC_COLS} FROM employees WHERE id = ?`, id);
  },

  findByUsername(username) {
    return get('SELECT * FROM employees WHERE username = ?', String(username || '').trim().toLowerCase());
  },

  create({ full_name, username, password, role, phone, hourly_wage }) {
    const r = run(
      `INSERT INTO employees (full_name, username, password_hash, role, phone, hourly_wage)
       VALUES (?, ?, ?, ?, ?, ?)`,
      full_name.trim(), username.trim().toLowerCase(), hashPassword(password), role,
      phone || null, Number(hourly_wage) || 0,
    );
    return NhanVien.findById(Number(r.lastInsertRowid));
  },

  update(id, { full_name, role, phone, hourly_wage, active, password }) {
    const cur = get('SELECT * FROM employees WHERE id = ?', id);
    if (!cur) return null;
    run(
      `UPDATE employees SET full_name = ?, role = ?, phone = ?, hourly_wage = ?, active = ?, password_hash = ?
       WHERE id = ?`,
      full_name ?? cur.full_name,
      role ?? cur.role,
      phone ?? cur.phone,
      hourly_wage ?? cur.hourly_wage,
      active === undefined ? cur.active : (active ? 1 : 0),
      password ? hashPassword(password) : cur.password_hash,
      id,
    );
    return NhanVien.findById(id);
  },
};

module.exports = NhanVien;
