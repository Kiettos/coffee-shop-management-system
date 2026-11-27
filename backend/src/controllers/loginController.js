const NhanVien = require('../models/NhanVien');
const { signToken } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');

// Chống dò mật khẩu đơn giản: khóa 5 phút sau 5 lần sai liên tiếp
const attempts = new Map();

exports.login = (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw new HttpError(400, 'Vui lòng nhập tên đăng nhập và mật khẩu');
  const key = String(username).toLowerCase();
  const a = attempts.get(key);
  if (a && a.count >= 5 && Date.now() - a.last < 5 * 60 * 1000) {
    throw new HttpError(429, 'Đăng nhập sai quá nhiều lần, vui lòng thử lại sau 5 phút');
  }

  const emp = NhanVien.findByUsername(username);
  if (!emp || !NhanVien.verifyPassword(password, emp.password_hash)) {
    attempts.set(key, { count: (a?.count || 0) + 1, last: Date.now() });
    throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu');
  }
  if (!emp.active) throw new HttpError(403, 'Tài khoản đã bị khóa, liên hệ quản lý');
  attempts.delete(key);

  const user = NhanVien.findById(emp.id);
  res.json({ token: signToken(user), user });
};

exports.me = (req, res) => {
  const user = NhanVien.findById(req.user.id);
  if (!user || !user.active) throw new HttpError(401, 'Tài khoản không còn hiệu lực');
  res.json({ user });
};

exports.changePassword = (req, res) => {
  const { old_password, new_password } = req.body || {};
  const emp = NhanVien.findByUsername(NhanVien.findById(req.user.id).username);
  if (!NhanVien.verifyPassword(old_password, emp.password_hash)) throw new HttpError(400, 'Mật khẩu cũ không đúng');
  if (!new_password || String(new_password).length < 6) throw new HttpError(400, 'Mật khẩu mới phải có ít nhất 6 ký tự');
  NhanVien.update(emp.id, { password: new_password });
  res.json({ ok: true });
};
