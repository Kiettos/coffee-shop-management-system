/**
 * Báo cáo & phân tích dữ liệu.
 * Mọi hàm nhận range từ normalizeRange(): { from, to, start, end, prev }.
 * Doanh thu chỉ tính các đơn đã thanh toán (status = 'paid').
 */
const { all, get } = require('../config/db');
const { productCostMap } = require('./costService');
const { normalizeRange, fmtDate, addDays, parseDate } = require('../utils/date');

const PAID = "o.status = 'paid' AND o.created_at >= ? AND o.created_at < ?";
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (cur, prev) => (prev ? r2(((cur - prev) / prev) * 100) : (cur ? null : 0));

/* ---------- 1. Tổng quan + so sánh kỳ trước ---------- */
function periodTotals(start, end) {
  const o = get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(cost_total),0) AS cost,
                        COALESCE(SUM(discount),0) AS discount
                 FROM orders o WHERE ${PAID}`, start, end);
  const items = get(`SELECT COALESCE(SUM(i.quantity),0) AS n FROM order_items i JOIN orders o ON o.id = i.order_id
                     WHERE ${PAID} AND i.status = 'ok'`, start, end).n;
  const cancelled = get(`SELECT COUNT(*) AS n FROM orders o WHERE o.status='cancelled' AND o.created_at >= ? AND o.created_at < ?`, start, end).n;
  const profit = o.revenue - o.cost;
  return {
    revenue: r2(o.revenue), orders: o.orders, items_sold: items, cost: r2(o.cost), profit: r2(profit),
    discount: r2(o.discount), avg_order: o.orders ? r2(o.revenue / o.orders) : 0,
    margin: o.revenue ? r2((profit / o.revenue) * 100) : 0, cancelled_orders: cancelled,
  };
}

function summary(range) {
  const current = periodTotals(range.start, range.end);
  const previous = periodTotals(range.prev.start, range.prev.end);
  const change = {};
  for (const k of ['revenue', 'orders', 'items_sold', 'profit', 'avg_order', 'cost']) change[k] = pct(current[k], previous[k]);
  return { range: { from: range.from, to: range.to, days: range.days }, previous_range: { from: range.prev.from, to: range.prev.to }, current, previous, change };
}

/* ---------- 2. Doanh thu theo ngày / tuần / tháng ---------- */
function timeseries(range, group = 'day') {
  const fmt = { day: '%Y-%m-%d', week: '%Y-W%W', month: '%Y-%m' }[group] || '%Y-%m-%d';
  const rows = all(`SELECT strftime('${fmt}', o.created_at) AS period, COUNT(*) AS orders,
                           SUM(o.total) AS revenue, SUM(o.total - o.cost_total) AS profit
                    FROM orders o WHERE ${PAID} GROUP BY period ORDER BY period`, range.start, range.end);
  const map = new Map(rows.map((r) => [r.period, r]));
  // điền các kỳ không có đơn = 0 để biểu đồ liên tục
  const out = [];
  const seen = new Set();
  for (let d = parseDate(range.from); d <= parseDate(range.to); d = addDays(d, 1)) {
    const key = periodKey(d, group);
    if (seen.has(key)) continue;
    seen.add(key);
    const r = map.get(key);
    out.push({ period: key, orders: r?.orders || 0, revenue: r2(r?.revenue), profit: r2(r?.profit) });
  }
  // so sánh từng kỳ với kỳ liền trước
  out.forEach((p, i) => { p.change = i ? pct(p.revenue, out[i - 1].revenue) : null; });
  return out;
}

function periodKey(d, group) {
  const s = fmtDate(d);
  if (group === 'month') return s.slice(0, 7);
  if (group === 'week') {
    // giống strftime('%W'): tuần bắt đầu thứ Hai, tuần 00 trước thứ Hai đầu tiên
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const yday = Math.round((d - jan1) / 86400000);
    const wd = (d.getDay() + 6) % 7; // thứ Hai = 0
    const w = Math.floor((yday - wd + 7) / 7);
    return `${d.getFullYear()}-W${String(w).padStart(2, '0')}`;
  }
  return s;
}

/* ---------- 3. Theo phương thức thanh toán ---------- */
function byPayment(range) {
  const rows = all(`SELECT o.payment_method AS method, COUNT(*) AS orders, SUM(o.total) AS revenue
                    FROM orders o WHERE ${PAID} GROUP BY o.payment_method`, range.start, range.end);
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  const failed = all(`SELECT p.method, COUNT(*) AS n FROM payments p WHERE p.status='failed' AND p.created_at >= ? AND p.created_at < ?
                      GROUP BY p.method`, range.start, range.end);
  return ['cash', 'qr'].map((m) => {
    const r = rows.find((x) => x.method === m) || { orders: 0, revenue: 0 };
    return {
      method: m, label: m === 'cash' ? 'Tiền mặt' : 'Chuyển khoản QR', orders: r.orders, revenue: r2(r.revenue),
      share: total ? r2((r.revenue / total) * 100) : 0, failed: failed.find((f) => f.method === m)?.n || 0,
    };
  });
}

/* ---------- 4. Theo ca & theo thu ngân ---------- */
const SHIFT_SQL = `CASE WHEN CAST(strftime('%H', o.created_at) AS INTEGER) BETWEEN 6 AND 11 THEN 'morning'
                        WHEN CAST(strftime('%H', o.created_at) AS INTEGER) BETWEEN 12 AND 17 THEN 'afternoon'
                        WHEN CAST(strftime('%H', o.created_at) AS INTEGER) BETWEEN 18 AND 23 THEN 'evening'
                        ELSE 'night' END`;
const SHIFTS = { morning: 'Ca sáng (06–12h)', afternoon: 'Ca chiều (12–18h)', evening: 'Ca tối (18–24h)', night: 'Ngoài giờ (0–6h)' };

function byShift(range) {
  const rows = all(`SELECT ${SHIFT_SQL} AS shift, COUNT(*) AS orders, SUM(o.total) AS revenue, SUM(o.total - o.cost_total) AS profit
                    FROM orders o WHERE ${PAID} GROUP BY shift`, range.start, range.end);
  return Object.keys(SHIFTS)
    .map((k) => {
      const r = rows.find((x) => x.shift === k) || {};
      return { shift: k, label: SHIFTS[k], orders: r.orders || 0, revenue: r2(r.revenue), profit: r2(r.profit),
        avg_order: r.orders ? r2(r.revenue / r.orders) : 0 };
    })
    .filter((s) => s.shift !== 'night' || s.orders > 0);
}

function byCashier(range) {
  return all(`SELECT e.id, e.full_name AS name, e.role, COUNT(o.id) AS orders, COALESCE(SUM(o.total),0) AS revenue,
                     SUM(CASE WHEN o.payment_method='cash' THEN o.total ELSE 0 END) AS cash,
                     SUM(CASE WHEN o.payment_method='qr' THEN o.total ELSE 0 END) AS qr,
                     (SELECT COUNT(*) FROM orders c WHERE c.employee_id = e.id AND c.status='cancelled'
                        AND c.created_at >= ? AND c.created_at < ?) AS cancelled
              FROM employees e JOIN orders o ON o.employee_id = e.id AND ${PAID}
              GROUP BY e.id ORDER BY revenue DESC`, range.start, range.end, range.start, range.end)
    .map((r) => ({ ...r, revenue: r2(r.revenue), cash: r2(r.cash), qr: r2(r.qr), avg_order: r.orders ? r2(r.revenue / r.orders) : 0 }));
}

/* ---------- 5. Món bán chạy / bán chậm + lợi nhuận theo món ---------- */
function productStats(range) {
  const costs = productCostMap();
  const sold = all(`SELECT i.product_id, SUM(i.quantity) AS qty, SUM(i.quantity*i.unit_price) AS revenue,
                           SUM(i.quantity*i.unit_cost) AS cost
                    FROM order_items i JOIN orders o ON o.id = i.order_id
                    WHERE ${PAID} AND i.status='ok' GROUP BY i.product_id`, range.start, range.end);
  const map = new Map(sold.map((s) => [s.product_id, s]));
  return all(`SELECT p.id, p.name, p.price, p.active, c.name AS category FROM products p
              JOIN categories c ON c.id = p.category_id ORDER BY p.id`)
    .filter((p) => p.active || map.has(p.id))
    .map((p) => {
      const s = map.get(p.id) || { qty: 0, revenue: 0, cost: 0 };
      const unitCost = costs.get(p.id) || 0;
      return {
        id: p.id, name: p.name, category: p.category, price: p.price,
        unit_cost: r2(unitCost), unit_profit: r2(p.price - unitCost),
        unit_margin: p.price ? r2(((p.price - unitCost) / p.price) * 100) : 0,
        qty: s.qty, revenue: r2(s.revenue), cost: r2(s.cost), profit: r2(s.revenue - s.cost),
      };
    });
}

function topProducts(range, limit = 10) {
  const stats = productStats(range);
  const byQty = [...stats].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  return {
    best: byQty.slice(0, limit),
    worst: [...stats].sort((a, b) => a.qty - b.qty || a.revenue - b.revenue).slice(0, limit),
  };
}

function productProfit(range) {
  return productStats(range).sort((a, b) => b.profit - a.profit);
}

/* ---------- 6. Theo danh mục ---------- */
function byCategory(range) {
  const rows = all(`SELECT c.id, c.name, COALESCE(SUM(i.quantity),0) AS qty, COALESCE(SUM(i.quantity*i.unit_price),0) AS revenue,
                           COALESCE(SUM(i.quantity*i.unit_cost),0) AS cost
                    FROM categories c
                    LEFT JOIN products p ON p.category_id = c.id
                    LEFT JOIN order_items i ON i.product_id = p.id AND i.status='ok'
                      AND i.order_id IN (SELECT o.id FROM orders o WHERE ${PAID})
                    GROUP BY c.id ORDER BY revenue DESC`, range.start, range.end);
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  return rows.map((r) => ({ ...r, revenue: r2(r.revenue), cost: r2(r.cost), profit: r2(r.revenue - r.cost),
    share: total ? r2((r.revenue / total) * 100) : 0 }));
}

/* ---------- 7. Nguyên liệu tiêu hao theo kỳ ---------- */
function ingredientUsage(range) {
  const rows = all(`SELECT i.id, i.name, i.unit, i.cost_per_unit, i.stock,
        COALESCE(SUM(CASE WHEN t.type IN ('consume','return') THEN -t.quantity END),0) AS used,
        COALESCE(SUM(CASE WHEN t.type IN ('consume','return') THEN -t.quantity*t.unit_cost END),0) AS used_value,
        COALESCE(SUM(CASE WHEN t.type='import' THEN t.quantity END),0) AS imported,
        COALESCE(SUM(CASE WHEN t.type='import' THEN t.quantity*t.unit_cost END),0) AS imported_value,
        COALESCE(SUM(CASE WHEN t.type='waste' THEN -t.quantity END),0) AS wasted
      FROM ingredients i
      LEFT JOIN inventory_transactions t ON t.ingredient_id = i.id AND t.created_at >= ? AND t.created_at < ?
      GROUP BY i.id ORDER BY used_value DESC`, range.start, range.end);
  return rows.map((r) => ({ ...r, used: r2(r.used), used_value: r2(r.used_value), imported: r2(r.imported),
    imported_value: r2(r.imported_value), wasted: r2(r.wasted), avg_per_day: r2(r.used / range.days) }));
}

/* ---------- 8. Lý thuyết vs thực tế (chênh lệch = thất thoát) ----------
 * Lý thuyết  = lượng nguyên liệu lẽ ra phải dùng theo công thức của các món đã bán (consume - return)
 * Thực tế    = lý thuyết + hủy/hỏng đã khai báo (waste) + chênh lệch phát hiện khi kiểm kê (stock_counts)
 * Thất thoát = thực tế - lý thuyết (không giải thích được bằng bán hàng)
 */
function lossReport(range) {
  const usage = ingredientUsage(range);
  const counts = all(`SELECT ingredient_id, SUM(difference) AS diff, SUM(difference*unit_cost) AS diff_value, COUNT(*) AS n,
                             MAX(created_at) AS last_count
                      FROM stock_counts WHERE created_at >= ? AND created_at < ? GROUP BY ingredient_id`, range.start, range.end);
  const cmap = new Map(counts.map((c) => [c.ingredient_id, c]));
  const rows = usage.map((u) => {
    const c = cmap.get(u.id) || { diff: 0, diff_value: 0, n: 0, last_count: null };
    const missing = -c.diff; // kiểm kê thiếu (counted < system) => dương
    const theoretical = u.used;
    const actual = theoretical + u.wasted + missing;
    const loss = actual - theoretical;
    return {
      id: u.id, name: u.name, unit: u.unit, theoretical: r2(theoretical), actual: r2(actual),
      wasted: r2(u.wasted), count_diff: r2(missing), loss: r2(loss),
      loss_pct: actual ? r2((loss / actual) * 100) : 0,
      loss_value: r2(loss * u.cost_per_unit), counts: c.n, last_count: c.last_count,
    };
  });
  const totalTheo = rows.reduce((s, r) => s + r.theoretical * (usage.find((u) => u.id === r.id).cost_per_unit), 0);
  const totalLoss = rows.reduce((s, r) => s + r.loss_value, 0);
  return {
    rows: rows.sort((a, b) => b.loss_value - a.loss_value),
    total_theoretical_value: r2(totalTheo), total_loss_value: r2(totalLoss),
    loss_rate: totalTheo + totalLoss ? r2((totalLoss / (totalTheo + totalLoss)) * 100) : 0,
  };
}

/* ---------- NÂNG CAO 1. Dự báo ngày hết hàng ---------- */
function stockForecast(windowDays = 14) {
  const now = new Date();
  const since = `${fmtDate(addDays(now, -windowDays))} 00:00:00`;
  const rows = all(`SELECT i.id, i.name, i.unit, i.stock, i.min_stock, i.cost_per_unit, i.supplier,
        COALESCE(SUM(CASE WHEN t.type IN ('consume','return','waste') THEN -t.quantity END),0) AS used,
        COALESCE(SUM(CASE WHEN t.type IN ('consume','return','waste') AND t.created_at >= ? THEN -t.quantity END),0) AS used_recent
      FROM ingredients i LEFT JOIN inventory_transactions t ON t.ingredient_id = i.id AND t.created_at >= ?
      GROUP BY i.id`, `${fmtDate(addDays(now, -Math.ceil(windowDays / 2)))} 00:00:00`, since);
  return rows.map((r) => {
    const rate = r.used / windowDays; // tốc độ tiêu thụ trung bình / ngày
    const recentRate = r.used_recent / Math.ceil(windowDays / 2);
    const trend = rate ? r2(((recentRate - rate) / rate) * 100) : 0; // nửa kỳ gần đây so với cả kỳ
    const useRate = Math.max(rate, recentRate); // thận trọng: lấy tốc độ cao hơn
    const daysLeft = useRate > 0 ? r.stock / useRate : null;
    const status = r.stock <= 0 ? 'out' : daysLeft !== null && daysLeft <= 3 ? 'critical'
      : (daysLeft !== null && daysLeft <= 7) || r.stock <= r.min_stock ? 'warning' : 'ok';
    // gợi ý nhập đủ dùng 14 ngày
    const suggest = Math.max(0, useRate * 14 - r.stock);
    return {
      id: r.id, name: r.name, unit: r.unit, stock: r2(r.stock), min_stock: r.min_stock, supplier: r.supplier,
      daily_usage: r2(useRate), trend_pct: trend,
      days_left: daysLeft === null ? null : r2(daysLeft),
      stockout_date: daysLeft === null ? null : fmtDate(addDays(now, Math.floor(daysLeft))),
      status, suggest_import: Math.ceil(suggest), suggest_cost: r2(Math.ceil(suggest) * r.cost_per_unit),
    };
  }).sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9));
}

/* ---------- NÂNG CAO 2. Tỷ lệ món bị hủy, món hết nguyên liệu ---------- */
function cancelStats(range) {
  const rows = all(`SELECT p.id, p.name, c.name AS category,
        COALESCE((SELECT SUM(i.quantity) FROM order_items i JOIN orders o ON o.id=i.order_id
                  WHERE i.product_id=p.id AND o.created_at >= ? AND o.created_at < ?),0) AS ordered,
        COALESCE((SELECT SUM(i.quantity) FROM order_items i JOIN orders o ON o.id=i.order_id
                  WHERE i.product_id=p.id AND i.status='cancelled' AND o.created_at >= ? AND o.created_at < ?),0) AS cancelled,
        (SELECT COUNT(*) FROM stockout_events s WHERE s.product_id=p.id AND s.created_at >= ? AND s.created_at < ?) AS stockouts
      FROM products p JOIN categories c ON c.id = p.category_id`,
  range.start, range.end, range.start, range.end, range.start, range.end);
  const reasons = all(`SELECT COALESCE(i.cancel_reason,'Không rõ') AS reason, SUM(i.quantity) AS qty
                       FROM order_items i JOIN orders o ON o.id=i.order_id
                       WHERE i.status='cancelled' AND o.created_at >= ? AND o.created_at < ?
                       GROUP BY reason ORDER BY qty DESC`, range.start, range.end);
  const list = rows.map((r) => ({
    ...r,
    cancel_rate: r.ordered ? r2((r.cancelled / r.ordered) * 100) : 0,
    stockout_rate: r.ordered + r.stockouts ? r2((r.stockouts / (r.ordered + r.stockouts)) * 100) : 0,
  })).filter((r) => r.ordered || r.stockouts)
    .sort((a, b) => (b.cancel_rate + b.stockout_rate) - (a.cancel_rate + a.stockout_rate));
  const totOrdered = list.reduce((s, r) => s + r.ordered, 0);
  const totCancelled = list.reduce((s, r) => s + r.cancelled, 0);
  const totStockouts = list.reduce((s, r) => s + r.stockouts, 0);
  return {
    rows: list, reasons,
    total: {
      ordered: totOrdered, cancelled: totCancelled, stockouts: totStockouts,
      cancel_rate: totOrdered ? r2((totCancelled / totOrdered) * 100) : 0,
      stockout_rate: totOrdered + totStockouts ? r2((totStockouts / (totOrdered + totStockouts)) * 100) : 0,
    },
  };
}

/* ---------- NÂNG CAO 3. Heatmap giờ cao điểm (giờ x thứ) ---------- */
function heatmap(range, metric = 'orders') {
  const rows = all(`SELECT CAST(strftime('%w', o.created_at) AS INTEGER) AS wd, CAST(strftime('%H', o.created_at) AS INTEGER) AS hour,
                           COUNT(*) AS orders, SUM(o.total) AS revenue
                    FROM orders o WHERE ${PAID} GROUP BY wd, hour`, range.start, range.end);
  // hàng: Thứ 2 .. Chủ nhật ; cột: 6h .. 23h
  const days = [1, 2, 3, 4, 5, 6, 0];
  const labels = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);
  const matrix = days.map((wd) => hours.map((h) => {
    const r = rows.find((x) => x.wd === wd && x.hour === h);
    return metric === 'revenue' ? r2(r?.revenue) : (r?.orders || 0);
  }));
  let peak = { value: 0 };
  matrix.forEach((row, di) => row.forEach((v, hi) => { if (v > peak.value) peak = { value: v, day: labels[di], hour: hours[hi] }; }));
  return { metric, days: labels, hours, matrix, peak };
}

/** Gom toàn bộ báo cáo - dùng cho trang tổng hợp và xuất Excel/PDF */
function fullReport(from, to, group = 'day') {
  const range = normalizeRange(from, to);
  return {
    range,
    summary: summary(range),
    timeseries: timeseries(range, group),
    payment: byPayment(range),
    shift: byShift(range),
    cashier: byCashier(range),
    top: topProducts(range),
    profit: productProfit(range),
    category: byCategory(range),
    usage: ingredientUsage(range),
    loss: lossReport(range),
    forecast: stockForecast(),
    cancel: cancelStats(range),
    heatmap: heatmap(range),
  };
}

module.exports = {
  normalizeRange, summary, timeseries, byPayment, byShift, byCashier, topProducts, productProfit,
  byCategory, ingredientUsage, lossReport, stockForecast, cancelStats, heatmap, fullReport, SHIFTS,
};
