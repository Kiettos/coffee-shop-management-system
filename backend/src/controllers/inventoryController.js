/** Quản lý kho: nguyên liệu, nhập hàng, hủy hàng, kiểm kê, lịch sử */
const { all, get, run, transaction } = require('../config/db');
const { HttpError } = require('../middleware/errorHandler');

const r2 = (n) => Math.round(n * 1000) / 1000;

exports.list = (_req, res) => {
  res.json(all(`SELECT i.*, (SELECT COUNT(*) FROM recipes r WHERE r.ingredient_id = i.id) AS used_in,
                       CASE WHEN i.stock <= 0 THEN 'out' WHEN i.stock <= i.min_stock THEN 'low' ELSE 'ok' END AS level
                FROM ingredients i ORDER BY i.name`));
};

function validate(b) {
  const name = String(b.name || '').trim();
  const unit = String(b.unit || '').trim();
  if (!name || !unit) throw new HttpError(400, 'Tên và đơn vị tính không được trống');
  const min = Number(b.min_stock || 0);
  const cost = Number(b.cost_per_unit || 0);
  if (min < 0 || cost < 0) throw new HttpError(400, 'Giá trị không được âm');
  return { name, unit, min_stock: min, cost_per_unit: cost, supplier: b.supplier || null };
}

exports.create = (req, res) => {
  const v = validate(req.body || {});
  if (get('SELECT 1 FROM ingredients WHERE name = ?', v.name)) throw new HttpError(409, 'Nguyên liệu đã tồn tại');
  const stock = Math.max(Number(req.body.stock) || 0, 0);
  const id = transaction((conn) => {
    const r = conn.prepare('INSERT INTO ingredients (name, unit, stock, min_stock, cost_per_unit, supplier) VALUES (?, ?, ?, ?, ?, ?)')
      .run(v.name, v.unit, stock, v.min_stock, v.cost_per_unit, v.supplier);
    const iid = Number(r.lastInsertRowid);
    if (stock > 0) {
      conn.prepare("INSERT INTO inventory_transactions (ingredient_id, type, quantity, unit_cost, employee_id, note) VALUES (?, 'import', ?, ?, ?, 'Tồn đầu kỳ')")
        .run(iid, stock, v.cost_per_unit, req.user.id);
    }
    return iid;
  });
  res.status(201).json(get('SELECT * FROM ingredients WHERE id = ?', id));
};

exports.update = (req, res) => {
  const cur = get('SELECT * FROM ingredients WHERE id = ?', req.params.id);
  if (!cur) throw new HttpError(404, 'Không tìm thấy nguyên liệu');
  const v = validate({ ...cur, ...req.body });
  run('UPDATE ingredients SET name=?, unit=?, min_stock=?, cost_per_unit=?, supplier=? WHERE id=?',
    v.name, v.unit, v.min_stock, v.cost_per_unit, v.supplier, cur.id);
  res.json(get('SELECT * FROM ingredients WHERE id = ?', cur.id));
};

exports.remove = (req, res) => {
  const id = req.params.id;
  if (get('SELECT 1 FROM recipes WHERE ingredient_id = ?', id)) throw new HttpError(409, 'Nguyên liệu đang được dùng trong công thức món');
  if (get('SELECT 1 FROM inventory_transactions WHERE ingredient_id = ?', id)) throw new HttpError(409, 'Nguyên liệu đã có lịch sử kho, không thể xóa');
  run('DELETE FROM ingredients WHERE id = ?', id);
  res.json({ ok: true });
};

/** Nhập hàng: cập nhật tồn + giá vốn bình quân gia quyền */
exports.importStock = (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
  const note = req.body?.note || 'Nhập hàng';
  transaction((conn) => {
    for (const it of items) {
      const ing = conn.prepare('SELECT * FROM ingredients WHERE id = ?').get(it.ingredient_id);
      const qty = Number(it.quantity);
      if (!ing) throw new HttpError(404, 'Không tìm thấy nguyên liệu');
      if (!(qty > 0)) throw new HttpError(400, `Số lượng nhập của "${ing.name}" phải lớn hơn 0`);
      const unitCost = it.unit_cost === undefined || it.unit_cost === '' ? ing.cost_per_unit : Number(it.unit_cost);
      if (!(unitCost >= 0)) throw new HttpError(400, 'Đơn giá nhập không hợp lệ');
      const base = Math.max(ing.stock, 0);
      const avg = base + qty > 0 ? (base * ing.cost_per_unit + qty * unitCost) / (base + qty) : unitCost;
      conn.prepare('UPDATE ingredients SET stock = stock + ?, cost_per_unit = ? WHERE id = ?').run(qty, r2(avg), ing.id);
      conn.prepare("INSERT INTO inventory_transactions (ingredient_id, type, quantity, unit_cost, employee_id, note) VALUES (?, 'import', ?, ?, ?, ?)")
        .run(ing.id, qty, unitCost, req.user.id, it.note || note);
    }
  });
  res.json({ ok: true });
};

/** Hủy hàng hỏng / đổ vỡ / hết hạn */
exports.waste = (req, res) => {
  const { ingredient_id, quantity, note } = req.body || {};
  const ing = get('SELECT * FROM ingredients WHERE id = ?', ingredient_id);
  const qty = Number(quantity);
  if (!ing) throw new HttpError(404, 'Không tìm thấy nguyên liệu');
  if (!(qty > 0)) throw new HttpError(400, 'Số lượng hủy phải lớn hơn 0');
  transaction((conn) => {
    conn.prepare('UPDATE ingredients SET stock = stock - ? WHERE id = ?').run(qty, ing.id);
    conn.prepare("INSERT INTO inventory_transactions (ingredient_id, type, quantity, unit_cost, employee_id, note) VALUES (?, 'waste', ?, ?, ?, ?)")
      .run(ing.id, -qty, ing.cost_per_unit, req.user.id, note || 'Hủy hàng hỏng');
  });
  res.json({ ok: true });
};

/** Kiểm kê: nhập số lượng đếm thực tế -> ghi chênh lệch (thất thoát) và điều chỉnh tồn */
exports.stockCount = (req, res) => {
  const counts = Array.isArray(req.body?.counts) ? req.body.counts : [];
  if (!counts.length) throw new HttpError(400, 'Chưa có số liệu kiểm kê');
  const results = transaction((conn) => counts.map((c) => {
    const ing = conn.prepare('SELECT * FROM ingredients WHERE id = ?').get(c.ingredient_id);
    const counted = Number(c.counted_qty);
    if (!ing) throw new HttpError(404, 'Không tìm thấy nguyên liệu');
    if (!(counted >= 0)) throw new HttpError(400, `Số lượng đếm của "${ing.name}" không hợp lệ`);
    const diff = r2(counted - ing.stock);
    conn.prepare('INSERT INTO stock_counts (ingredient_id, system_qty, counted_qty, difference, unit_cost, employee_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ing.id, ing.stock, counted, diff, ing.cost_per_unit, req.user.id, c.note || req.body.note || null);
    if (diff !== 0) {
      conn.prepare('UPDATE ingredients SET stock = ? WHERE id = ?').run(counted, ing.id);
      conn.prepare("INSERT INTO inventory_transactions (ingredient_id, type, quantity, unit_cost, employee_id, note) VALUES (?, 'adjust', ?, ?, ?, 'Điều chỉnh sau kiểm kê')")
        .run(ing.id, diff, ing.cost_per_unit, req.user.id);
    }
    return { ingredient: ing.name, unit: ing.unit, system_qty: ing.stock, counted_qty: counted, difference: diff, value: Math.round(diff * ing.cost_per_unit) };
  }));
  res.json({ ok: true, results });
};

exports.transactions = (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.ingredient_id) { where += ' AND t.ingredient_id = ?'; params.push(req.query.ingredient_id); }
  if (req.query.type) { where += ' AND t.type = ?'; params.push(req.query.type); }
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(all(`SELECT t.*, i.name AS ingredient, i.unit, e.full_name AS employee
                FROM inventory_transactions t JOIN ingredients i ON i.id = t.ingredient_id
                LEFT JOIN employees e ON e.id = t.employee_id
                WHERE ${where} ORDER BY t.id DESC LIMIT ${limit}`, ...params));
};

exports.counts = (_req, res) => {
  res.json(all(`SELECT s.*, i.name AS ingredient, i.unit, e.full_name AS employee FROM stock_counts s
                JOIN ingredients i ON i.id = s.ingredient_id LEFT JOIN employees e ON e.id = s.employee_id
                ORDER BY s.id DESC LIMIT 300`));
};
