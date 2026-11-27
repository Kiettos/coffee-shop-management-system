const jwt = require('jsonwebtoken');
const { HttpError } = require('./errorHandler');

const secret = () => process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(emp) {
  return jwt.sign({ id: emp.id, role: emp.role, name: emp.full_name }, secret(), { expiresIn: '12h' });
}

/** Bắt buộc đăng nhập. Token gửi qua header Authorization: Bearer <token> hoặc ?token= (khi tải file). */
function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return next(new HttpError(401, 'Chưa đăng nhập'));
  try {
    req.user = jwt.verify(token, secret());
    next();
  } catch {
    next(new HttpError(401, 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại'));
  }
}

/** Giới hạn theo vai trò, ví dụ requireRole('admin','manager') */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'Bạn không có quyền thực hiện thao tác này'));
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole };
