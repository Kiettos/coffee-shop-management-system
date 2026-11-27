/** Nhật ký lỗi, cấu hình, kiểm tra kết nối */
const { all, get, run } = require('../config/db');
const { logError, HttpError } = require('../middleware/errorHandler');
const { getSettings, setSettings } = require('../services/settingsService');

exports.health = (_req, res) => {
  get('SELECT 1 AS ok');
  res.json({ ok: true, time: new Date().toISOString() });
};

exports.listErrors = (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.type) { where += ' AND l.type = ?'; params.push(req.query.type); }
  if (req.query.resolved === '0' || req.query.resolved === '1') { where += ' AND l.resolved = ?'; params.push(Number(req.query.resolved)); }
  const rows = all(`SELECT l.*, e.full_name AS employee FROM error_logs l LEFT JOIN employees e ON e.id = l.employee_id
                    WHERE ${where} ORDER BY l.id DESC LIMIT 500`, ...params);
  const stats = all(`SELECT type, COUNT(*) AS total, SUM(resolved = 0) AS open,
                            SUM(created_at >= datetime('now','localtime','-1 day')) AS last24h
                     FROM error_logs GROUP BY type`);
  res.json({ rows, stats });
};

exports.resolveError = (req, res) => {
  run('UPDATE error_logs SET resolved = 1 WHERE id = ?', req.params.id);
  res.json({ ok: true });
};

exports.resolveAll = (_req, res) => {
  run('UPDATE error_logs SET resolved = 1 WHERE resolved = 0');
  res.json({ ok: true });
};

/** Frontend gửi lên các lỗi phía trình duyệt (mất mạng, lỗi JS, request thất bại) */
exports.reportClientError = (req, res) => {
  const items = Array.isArray(req.body?.errors) ? req.body.errors.slice(0, 50) : [req.body];
  for (const e of items) {
    if (!e?.message) continue;
    const type = ['network', 'order', 'payment', 'client'].includes(e.type) ? e.type : 'client';
    logError(type, String(e.message).slice(0, 300), { ...e.detail, at: e.at, page: e.page }, req.user?.id);
  }
  res.json({ ok: true });
};

exports.getSettings = (_req, res) => res.json({ ...getSettings(), ai_enabled: Boolean(process.env.ANTHROPIC_API_KEY) });

exports.updateSettings = (req, res) => {
  const b = req.body || {};
  if (b.payment_fail_rate !== undefined) {
    const v = Number(b.payment_fail_rate);
    if (!(v >= 0 && v <= 1)) throw new HttpError(400, 'Tỷ lệ lỗi phải trong khoảng 0 - 1');
  }
  res.json(setSettings(b));
};
