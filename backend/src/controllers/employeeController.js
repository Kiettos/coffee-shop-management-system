const NhanVien = require('../models/NhanVien');
const { get, all } = require('../config/db');
const { HttpError } = require('../middleware/errorHandler');

exports.list = (_req, res) => {
  const stats = all(`SELECT employee_id, COUNT(*) AS orders, SUM(total) AS revenue FROM orders
                     WHERE status='paid' AND created_at >= date('now','localtime','start of month') GROUP BY employee_id`);
  res.json(NhanVien.findAll().map((e) => {
    const s = stats.find((x) => x.employee_id === e.id);
    return { ...e, role_label: NhanVien.ROLES[e.role], month_orders: s?.orders || 0, month_revenue: s?.revenue || 0 };
  }));
};

exports.create = (req, res) => {
  const b = req.body || {};
  if (!b.full_name?.trim() || !b.username?.trim()) throw new HttpError(400, 'Họ tên và tên đăng nhập không được trống');
  if (!/^[a-z0-9_.]{3,30}$/i.test(b.username.trim())) throw new HttpError(400, 'Tên đăng nhập chỉ gồm chữ, số, dấu _ . (3-30 ký tự)');
  if (!b.password || String(b.password).length < 6) throw new HttpError(400, 'Mật khẩu phải có ít nhất 6 ký tự');
  if (!NhanVien.ROLES[b.role]) throw new HttpError(400, 'Vai trò không hợp lệ');
  if (b.role === 'admin' && req.user.role !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên mới tạo được tài khoản quản trị');
  if (NhanVien.findByUsername(b.username)) throw new HttpError(409, 'Tên đăng nhập đã tồn tại');
  res.status(201).json(NhanVien.create(b));
};

exports.update = (req, res) => {
  const id = Number(req.params.id);
  const cur = NhanVien.findById(id);
  if (!cur) throw new HttpError(404, 'Không tìm thấy nhân viên');
  const b = req.body || {};
  if (b.role && !NhanVien.ROLES[b.role]) throw new HttpError(400, 'Vai trò không hợp lệ');
  if ((cur.role === 'admin' || b.role === 'admin') && req.user.role !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên mới sửa được tài khoản quản trị');
  if (id === req.user.id && (b.active === false || (b.role && b.role !== cur.role))) {
    throw new HttpError(400, 'Không thể tự khóa hoặc tự đổi vai trò của chính mình');
  }
  if (b.password && String(b.password).length < 6) throw new HttpError(400, 'Mật khẩu phải có ít nhất 6 ký tự');
  if (cur.role === 'admin' && (b.active === false || (b.role && b.role !== 'admin'))) {
    const admins = get("SELECT COUNT(*) AS n FROM employees WHERE role='admin' AND active=1").n;
    if (admins <= 1) throw new HttpError(400, 'Hệ thống phải còn ít nhất 1 quản trị viên');
  }
  res.json(NhanVien.update(id, b));
};
