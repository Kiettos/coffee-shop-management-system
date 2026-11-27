const { all, run } = require('../config/db');

const DEFAULTS = {
  shop_name: 'Coffee House',
  shop_address: '123 Đường Cà Phê, Quận 1, TP.HCM',
  // Tỷ lệ (0..1) giả lập cổng thanh toán QR bị lỗi - dùng để demo tính năng bắt lỗi thanh toán
  payment_fail_rate: '0',
};

function getSettings() {
  const out = { ...DEFAULTS };
  for (const r of all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}

function setSettings(obj) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (!(k in DEFAULTS)) continue;
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v));
  }
  return getSettings();
}

module.exports = { getSettings, setSettings };
