/**
 * Nghiệp vụ đơn hàng:
 *  - Tạo đơn: kiểm tra món, kiểm tra tồn kho theo công thức, trừ kho (tiêu hao lý thuyết)
 *  - Thanh toán: tiền mặt / QR, ghi lại giao dịch thất bại
 *  - Hủy đơn / hủy món: hoàn kho hoặc tính là hao hụt
 *  - Đồng bộ đơn tạo lúc mất mạng (offline)
 */
const { transaction, get, all } = require('../config/db');
const { HttpError, logError } = require('../middleware/errorHandler');
const { productCostMap } = require('./costService');
const { getSettings } = require('./settingsService');
const { fmtDateTime } = require('../utils/date');

const round = (n) => Math.round(n * 100) / 100;

function nextOrderCode(conn, createdAt) {
  const day = createdAt.slice(0, 10);
  const { n } = conn.prepare("SELECT COUNT(*) AS n FROM orders WHERE substr(created_at,1,10) = ?").get(day);
  const base = `HD${day.replace(/-/g, '').slice(2)}-`;
  let seq = n + 1;
  while (conn.prepare('SELECT 1 FROM orders WHERE code = ?').get(base + String(seq).padStart(4, '0'))) seq++;
  return base + String(seq).padStart(4, '0');
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Đơn hàng chưa có món nào');
  const merged = new Map();
  for (const it of items) {
    const pid = Number(it.product_id);
    const qty = Math.floor(Number(it.quantity));
    if (!pid || !(qty > 0)) throw new HttpError(400, 'Món hoặc số lượng không hợp lệ');
    const key = `${pid}|${it.note || ''}`;
    const cur = merged.get(key) || { product_id: pid, quantity: 0, note: it.note || null };
    cur.quantity += qty;
    merged.set(key, cur);
  }
  return [...merged.values()];
}

/**
 * Tạo đơn hàng.
 * @param {object} p
 * @param {Array<{product_id,quantity,note}>} p.items
 * @param {number} p.employeeId
 * @param {boolean} [p.offline]    đơn được tạo khi mất mạng, đồng bộ lại sau -> không chặn vì tồn kho
 * @param {string}  [p.createdAt]  thời điểm tạo thực tế (đơn offline)
 * @param {string}  [p.paymentMethod] nếu có -> đơn đã thanh toán luôn
 */
function createOrder({ items, employeeId, tableNo, note, discount = 0, clientUuid, offline = false, createdAt, paymentMethod }) {
  const lines = normalizeItems(items);
  const created = createdAt && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(createdAt)
    ? createdAt.replace('T', ' ').slice(0, 19).padEnd(19, ':00').slice(0, 19)
    : fmtDateTime(new Date());

  if (clientUuid) {
    const dup = get('SELECT id FROM orders WHERE client_uuid = ?', clientUuid);
    if (dup) return { order: getOrder(dup.id), duplicate: true };
  }

  const costs = productCostMap();

  const result = transaction((conn) => {
    // 1. Kiểm tra món
    const products = new Map();
    for (const l of lines) {
      const p = conn.prepare('SELECT id, name, price, active FROM products WHERE id = ?').get(l.product_id);
      if (!p) throw new HttpError(404, `Không tìm thấy món #${l.product_id}`);
      if (!p.active && !offline) throw new HttpError(409, `Món "${p.name}" đã ngừng bán`);
      products.set(p.id, p);
    }

    // 2. Tính nguyên liệu cần dùng theo công thức
    const need = new Map(); // ingredient_id -> {qty, products:Set}
    for (const l of lines) {
      const recipe = conn.prepare('SELECT ingredient_id, quantity FROM recipes WHERE product_id = ?').all(l.product_id);
      for (const r of recipe) {
        const cur = need.get(r.ingredient_id) || { qty: 0, products: new Set() };
        cur.qty += r.quantity * l.quantity;
        cur.products.add(l.product_id);
        need.set(r.ingredient_id, cur);
      }
    }

    // 3. Kiểm tra tồn kho (bỏ qua với đơn offline vì món đã bán thực tế)
    const ingInfo = new Map();
    const shortages = [];
    for (const [ingId, n] of need) {
      const ing = conn.prepare('SELECT id, name, unit, stock, cost_per_unit FROM ingredients WHERE id = ?').get(ingId);
      ingInfo.set(ingId, ing);
      if (!offline && ing.stock < n.qty - 1e-9) {
        shortages.push({ ingredient: ing.name, unit: ing.unit, need: round(n.qty), stock: round(ing.stock), ingredient_id: ingId, products: [...n.products] });
      }
    }
    if (shortages.length) {
      const err = new HttpError(409, 'Không đủ nguyên liệu để làm món', {
        code: 'OUT_OF_STOCK',
        shortages: shortages.map((s) => ({
          ...s,
          products: s.products.map((pid) => ({ id: pid, name: products.get(pid).name })),
        })),
      });
      err.shortages = shortages;
      throw err;
    }

    // 4. Ghi đơn
    const subtotal = lines.reduce((s, l) => s + products.get(l.product_id).price * l.quantity, 0);
    const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
    const costTotal = lines.reduce((s, l) => s + (costs.get(l.product_id) || 0) * l.quantity, 0);
    const code = nextOrderCode(conn, created);
    const paid = paymentMethod === 'cash' || paymentMethod === 'qr';

    const r = conn.prepare(`
      INSERT INTO orders (code, client_uuid, employee_id, table_no, status, payment_method, subtotal, discount, total,
                          cost_total, note, offline, created_at, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      code, clientUuid || null, employeeId, tableNo || null, paid ? 'paid' : 'pending', paid ? paymentMethod : null,
      round(subtotal), round(disc), round(subtotal - disc), round(costTotal), note || null, offline ? 1 : 0,
      created, paid ? created : null,
    );
    const orderId = Number(r.lastInsertRowid);

    const insItem = conn.prepare(`INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost, note)
                                  VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const l of lines) {
      const p = products.get(l.product_id);
      insItem.run(orderId, p.id, p.name, l.quantity, p.price, round(costs.get(p.id) || 0), l.note);
    }

    // 5. Trừ kho theo công thức (tiêu hao lý thuyết)
    const insTx = conn.prepare(`INSERT INTO inventory_transactions (ingredient_id, type, quantity, unit_cost, order_id, employee_id, note, created_at)
                                VALUES (?, 'consume', ?, ?, ?, ?, ?, ?)`);
    const upd = conn.prepare('UPDATE ingredients SET stock = stock - ? WHERE id = ?');
    for (const [ingId, n] of need) {
      insTx.run(ingId, -n.qty, ingInfo.get(ingId).cost_per_unit, orderId, employeeId, `Bán đơn ${code}`, created);
      upd.run(n.qty, ingId);
    }

    if (paid) {
      conn.prepare("INSERT INTO payments (order_id, method, amount, status, message, created_at) VALUES (?, ?, ?, 'success', ?, ?)")
        .run(orderId, paymentMethod, round(subtotal - disc), offline ? 'Thanh toán khi offline' : null, created);
    }
    return orderId;
  });

  return { order: getOrder(result), duplicate: false };
}

/** Ghi nhận sự kiện hết nguyên liệu (gọi khi createOrder ném lỗi OUT_OF_STOCK) */
function recordStockout(shortages, employeeId) {
  transaction((conn) => {
    const ins = conn.prepare('INSERT INTO stockout_events (product_id, ingredient_id, employee_id) VALUES (?, ?, ?)');
    for (const s of shortages) for (const pid of s.products) ins.run(pid, s.ingredient_id, employeeId || null);
  });
}

function getOrder(id) {
  const order = get(`SELECT o.*, e.full_name AS employee_name FROM orders o
                     JOIN employees e ON e.id = o.employee_id WHERE o.id = ?`, id);
  if (!order) return null;
  order.items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', id);
  order.payments = all('SELECT * FROM payments WHERE order_id = ? ORDER BY id', id);
  return order;
}

/** Thanh toán đơn. Cổng QR có thể lỗi (giả lập bằng settings.payment_fail_rate). */
function payOrder(id, { method, received, employeeId, simulateFailure }) {
  if (!['cash', 'qr'].includes(method)) throw new HttpError(400, 'Phương thức thanh toán không hợp lệ');
  const order = get('SELECT * FROM orders WHERE id = ?', id);
  if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng');
  if (order.status === 'paid') throw new HttpError(409, 'Đơn hàng đã được thanh toán trước đó');
  if (order.status === 'cancelled') throw new HttpError(409, 'Đơn hàng đã bị hủy, không thể thanh toán');

  if (method === 'cash' && received !== undefined && received !== null && received !== '' && Number(received) < order.total) {
    throw new HttpError(400, `Tiền khách đưa (${Number(received).toLocaleString('vi-VN')}đ) ít hơn tổng tiền`);
  }

  const failRate = Number(getSettings().payment_fail_rate) || 0;
  const failed = method === 'qr' && (simulateFailure || Math.random() < failRate);
  if (failed) {
    const msg = 'Cổng thanh toán QR không phản hồi / giao dịch bị từ chối';
    transaction((conn) => {
      conn.prepare("INSERT INTO payments (order_id, method, amount, status, message) VALUES (?, ?, ?, 'failed', ?)")
        .run(id, method, order.total, msg);
    });
    logError('payment', `Thanh toán thất bại đơn ${order.code}`, { order_id: id, method, amount: order.total, reason: msg }, employeeId);
    throw new HttpError(402, 'Thanh toán QR thất bại. Vui lòng thử lại hoặc chuyển sang tiền mặt.', { code: 'PAYMENT_FAILED' });
  }

  transaction((conn) => {
    const now = fmtDateTime(new Date());
    conn.prepare("UPDATE orders SET status = 'paid', payment_method = ?, paid_at = ? WHERE id = ?").run(method, now, id);
    conn.prepare("INSERT INTO payments (order_id, method, amount, status, created_at) VALUES (?, ?, ?, 'success', ?)")
      .run(id, method, order.total, now);
  });
  const out = getOrder(id);
  if (method === 'cash' && received) out.change = round(Number(received) - out.total);
  return out;
}

/** Hủy cả đơn. restock=true: hoàn nguyên liệu về kho; false: tính vào hao hụt (món đã pha). */
function cancelOrder(id, { reason, restock = true, employeeId }) {
  const order = get('SELECT * FROM orders WHERE id = ?', id);
  if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng');
  if (order.status === 'cancelled') throw new HttpError(409, 'Đơn hàng đã bị hủy trước đó');
  transaction((conn) => {
    // chỉ hoàn kho các món chưa bị hủy trước đó (tránh hoàn 2 lần)
    const okItems = conn.prepare("SELECT * FROM order_items WHERE order_id = ? AND status = 'ok'").all(id);
    conn.prepare("UPDATE orders SET status = 'cancelled', cancel_reason = ? WHERE id = ?").run(reason || 'Không rõ lý do', id);
    conn.prepare("UPDATE order_items SET status = 'cancelled', cancel_reason = COALESCE(cancel_reason, ?) WHERE order_id = ?")
      .run(reason || 'Hủy đơn', id);
    reverseConsumption(conn, id, okItems, restock, employeeId, `Hủy đơn ${order.code}`);
  });
  return getOrder(id);
}

/** Hủy 1 món trong đơn chưa thanh toán */
function cancelItem(orderId, itemId, { reason, restock = true, employeeId }) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng');
  if (order.status !== 'pending') throw new HttpError(409, 'Chỉ hủy món được với đơn chưa thanh toán');
  const item = get('SELECT * FROM order_items WHERE id = ? AND order_id = ?', itemId, orderId);
  if (!item) throw new HttpError(404, 'Không tìm thấy món trong đơn');
  if (item.status === 'cancelled') throw new HttpError(409, 'Món đã bị hủy');

  transaction((conn) => {
    conn.prepare("UPDATE order_items SET status = 'cancelled', cancel_reason = ? WHERE id = ?").run(reason || 'Khách đổi ý', itemId);
    reverseConsumption(conn, orderId, [item], restock, employeeId, `Hủy món ${item.product_name} - đơn ${order.code}`);
    const t = conn.prepare(`SELECT COALESCE(SUM(quantity*unit_price),0) AS sub, COALESCE(SUM(quantity*unit_cost),0) AS cost
                            FROM order_items WHERE order_id = ? AND status = 'ok'`).get(orderId);
    const disc = Math.min(order.discount, t.sub);
    if (t.sub === 0) {
      conn.prepare("UPDATE orders SET status='cancelled', subtotal=0, discount=0, total=0, cost_total=0, cancel_reason=? WHERE id=?")
        .run('Tất cả món bị hủy', orderId);
    } else {
      conn.prepare('UPDATE orders SET subtotal=?, discount=?, total=?, cost_total=? WHERE id=?')
        .run(round(t.sub), round(disc), round(t.sub - disc), round(t.cost), orderId);
    }
  });
  return getOrder(orderId);
}

function reverseConsumption(conn, orderId, items, restock, employeeId, note) {
  if (!restock) return; // nguyên liệu đã dùng -> giữ nguyên tiêu hao (được tính là hao hụt do hủy)
  const ins = conn.prepare(`INSERT INTO inventory_transactions (ingredient_id, type, quantity, unit_cost, order_id, employee_id, note)
                            VALUES (?, 'return', ?, ?, ?, ?, ?)`);
  const upd = conn.prepare('UPDATE ingredients SET stock = stock + ? WHERE id = ?');
  for (const it of items) {
    const recipe = conn.prepare(`SELECT r.ingredient_id, r.quantity, i.cost_per_unit FROM recipes r
                                 JOIN ingredients i ON i.id = r.ingredient_id WHERE r.product_id = ?`).all(it.product_id);
    for (const r of recipe) {
      const q = r.quantity * it.quantity;
      ins.run(r.ingredient_id, q, r.cost_per_unit, orderId, employeeId || null, note);
      upd.run(q, r.ingredient_id);
    }
  }
}

module.exports = { createOrder, recordStockout, getOrder, payOrder, cancelOrder, cancelItem };
