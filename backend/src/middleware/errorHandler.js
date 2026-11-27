/**
 * Xử lý lỗi tập trung: lỗi nghiệp vụ trả về đúng mã HTTP + thông báo tiếng Việt,
 * lỗi không lường trước được ghi vào bảng error_logs (loại 'system').
 */
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Bọc controller async/sync để lỗi luôn đi vào errorHandler */
const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (err) {
    next(err);
  }
};

function logError(type, message, detail, employeeId) {
  try {
    const { run } = require('../config/db');
    run(
      'INSERT INTO error_logs (type, message, detail, employee_id) VALUES (?, ?, ?, ?)',
      type, String(message).slice(0, 500),
      detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 4000) : null,
      employeeId || null,
    );
  } catch (e) {
    console.error('Không ghi được error_logs:', e.message);
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Dữ liệu gửi lên không hợp lệ' });
  }
  console.error(err);
  logError('system', err.message || 'Lỗi không xác định', { path: req.originalUrl, stack: err.stack }, req.user?.id);
  res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại. Sự cố đã được ghi nhận.' });
}

module.exports = { HttpError, wrap, errorHandler, logError };
