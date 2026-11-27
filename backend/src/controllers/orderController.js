const QRCode = require('qrcode');
const { all, get } = require('../config/db');
const { HttpError, logError } = require('../middleware/errorHandler');
const svc = require('../services/orderService');

exports.list = (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.status) { where += ' AND o.status = ?'; params.push(req.query.status); }
  if (req.query.from) { where += ' AND o.created_at >= ?'; params.push(`${req.query.from} 00:00:00`); }
  if (req.query.to) { where += " AND o.created_at < date(?, '+1 day')"; params.push(req.query.to); }
  if (req.query.q) { where += ' AND (o.code LIKE ? OR o.table_no LIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.user.role === 'cashier' || req.user.role === 'barista') {
    where += " AND o.created_at >= date('now','localtime')"; // nhân viên chỉ xem đơn trong ngày
  }
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const orders = all(`SELECT o.*, e.full_name AS employee_name,
                             (SELECT GROUP_CONCAT(i.quantity || 'x ' || i.product_name, ', ') FROM order_items i
                              WHERE i.order_id = o.id AND i.status='ok') AS summary
                      FROM orders o JOIN employees e ON e.id = o.employee_id
                      WHERE ${where} ORDER BY o.id DESC LIMIT ${limit}`, ...params);
  res.json(orders);
};

exports.get = (req, res) => {
  const o = svc.getOrder(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Không tìm thấy đơn hàng');
  res.json(o);
};

exports.create = (req, res) => {
  const b = req.body || {};
  try {
    const { order, duplicate } = svc.createOrder({
      items: b.items, employeeId: req.user.id, tableNo: b.table_no, note: b.note, discount: b.discount,
      clientUuid: b.client_uuid, paymentMethod: b.payment_method,
    });
    res.status(duplicate ? 200 : 201).json(order);
  } catch (err) {
    if (err.shortages) {
      svc.recordStockout(err.shortages, req.user.id);
      logError('order', 'Không tạo được đơn: hết nguyên liệu',
        err.shortages.map((s) => `${s.ingredient}: cần ${s.need}${s.unit}, còn ${s.stock}${s.unit}`).join('; '), req.user.id);
    } else if (!(err instanceof HttpError) || err.status >= 500) {
      logError('order', `Không tạo được đơn: ${err.message}`, { body: b }, req.user.id);
    }
    throw err;
  }
};

/** Đồng bộ các đơn được tạo khi mất mạng (lưu ở trình duyệt) */
exports.sync = (req, res) => {
  const list = Array.isArray(req.body?.orders) ? req.body.orders : [];
  const results = [];
  for (const o of list) {
    try {
      const { order, duplicate } = svc.createOrder({
        items: o.items, employeeId: req.user.id, tableNo: o.table_no, note: o.note, discount: o.discount,
        clientUuid: o.client_uuid, offline: true, createdAt: o.created_at, paymentMethod: o.payment_method || 'cash',
      });
      results.push({ client_uuid: o.client_uuid, ok: true, duplicate, code: order.code, id: order.id });
    } catch (err) {
      results.push({ client_uuid: o.client_uuid, ok: false, error: err.message });
      logError('order', `Đồng bộ đơn offline thất bại: ${err.message}`, o, req.user.id);
    }
  }
  const synced = results.filter((r) => r.ok && !r.duplicate).length;
  if (list.length) {
    logError('network', `Mất kết nối - đã đồng bộ ${synced}/${list.length} đơn tạo khi offline`,
      { first: list[0]?.created_at, last: list[list.length - 1]?.created_at }, req.user.id);
  }
  res.json({ results, synced });
};

exports.pay = (req, res) => {
  const b = req.body || {};
  res.json(svc.payOrder(Number(req.params.id), { method: b.method, received: b.received, employeeId: req.user.id, simulateFailure: b.simulate_failure }));
};

/** Sinh mã QR chuyển khoản cho đơn */
exports.qr = async (req, res) => {
  const o = get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (!o) throw new HttpError(404, 'Không tìm thấy đơn hàng');
  const bank = process.env.BANK_NAME || 'VCB';
  const acc = process.env.BANK_ACCOUNT || '0123456789';
  const owner = process.env.BANK_OWNER || 'COFFEE HOUSE';
  const payload = `BANK:${bank}|ACC:${acc}|NAME:${owner}|AMOUNT:${Math.round(o.total)}|MEMO:${o.code}`;
  const dataUrl = await QRCode.toDataURL(payload, { width: 280, margin: 1 });
  res.json({ qr: dataUrl, bank, account: acc, owner, amount: o.total, memo: o.code });
};

exports.cancel = (req, res) => {
  const b = req.body || {};
  if (!b.reason) throw new HttpError(400, 'Vui lòng nhập lý do hủy');
  const order = get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (order?.status === 'paid' && !['admin', 'manager'].includes(req.user.role)) {
    throw new HttpError(403, 'Đơn đã thanh toán chỉ quản lý mới được hủy');
  }
  res.json(svc.cancelOrder(Number(req.params.id), { reason: b.reason, restock: b.restock !== false, employeeId: req.user.id }));
};

exports.cancelItem = (req, res) => {
  const b = req.body || {};
  res.json(svc.cancelItem(Number(req.params.id), Number(req.params.itemId), { reason: b.reason, restock: b.restock !== false, employeeId: req.user.id }));
};
