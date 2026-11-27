/**
 * Dữ liệu mẫu: danh mục, món, công thức, nguyên liệu, nhân viên và
 * ~75 ngày hoạt động mô phỏng (đơn hàng theo giờ cao điểm, nhập kho, kiểm kê có thất thoát,
 * hủy món, hết nguyên liệu, thanh toán lỗi) để các báo cáo có dữ liệu ngay khi chạy.
 *
 *   node src/db/seed.js --reset   -> xóa toàn bộ dữ liệu và tạo lại
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { getDb, transaction, get, closeDb, resolveDbPath } = require('../config/db');
const { hashPassword } = require('../models/NhanVien');
const { fmtDate, fmtDateTime, addDays, pad } = require('../utils/date');

// ---------- RNG cố định để dữ liệu lặp lại được ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = ['Cà phê', 'Trà', 'Đá xay', 'Nước ép', 'Bánh'];

// [tên, đơn vị, giá vốn/đơn vị, tồn tối thiểu, nhà cung cấp]
const INGREDIENTS = [
  ['Cà phê Robusta', 'g', 350, 2000, 'Cà phê Buôn Ma Thuột'],
  ['Cà phê Arabica', 'g', 600, 1000, 'Cà phê Cầu Đất'],
  ['Sữa đặc', 'ml', 65, 2000, 'Vinamilk'],
  ['Sữa tươi', 'ml', 32, 5000, 'Dalat Milk'],
  ['Đường', 'g', 25, 2000, 'Đường Biên Hòa'],
  ['Đá viên', 'g', 2, 20000, 'Đá sạch Phương Nam'],
  ['Trà đen', 'g', 300, 300, 'Trà Phúc Long'],
  ['Trà ô long', 'g', 450, 300, 'Trà Phúc Long'],
  ['Bột matcha', 'g', 1200, 300, 'Matcha Uji Import'],
  ['Bột cacao', 'g', 400, 300, 'Cacao Bến Tre'],
  ['Kem whipping', 'ml', 120, 1000, 'Anchor'],
  ['Syrup đào', 'ml', 250, 500, 'Monin'],
  ['Syrup caramel', 'ml', 270, 500, 'Monin'],
  ['Đào ngâm', 'miếng', 3000, 40, 'Rhodes'],
  ['Sả', 'cây', 1000, 20, 'Chợ đầu mối'],
  ['Chanh', 'quả', 1500, 30, 'Chợ đầu mối'],
  ['Cam', 'quả', 5000, 30, 'Chợ đầu mối'],
  ['Bột base đá xay', 'g', 300, 500, 'Gia Thịnh'],
  ['Muối hồng', 'g', 100, 100, 'Bạc Liêu'],
  ['Bánh croissant', 'cái', 12000, 10, 'ABC Bakery'],
  ['Bánh tiramisu', 'cái', 18000, 8, 'ABC Bakery'],
  ['Bánh mì que', 'cái', 5000, 10, 'ABC Bakery'],
  ['Ly nhựa', 'cái', 1200, 200, 'Bao bì Tân Tiến'],
];

// [tên, danh mục, giá, độ phổ biến, công thức {nguyên liệu: định lượng}]
const PRODUCTS = [
  ['Cà phê đen đá', 'Cà phê', 25000, 9, { 'Cà phê Robusta': 20, 'Đường': 10, 'Đá viên': 150, 'Ly nhựa': 1 }],
  ['Cà phê sữa đá', 'Cà phê', 29000, 14, { 'Cà phê Robusta': 20, 'Sữa đặc': 30, 'Đá viên': 150, 'Ly nhựa': 1 }],
  ['Bạc xỉu', 'Cà phê', 32000, 10, { 'Cà phê Robusta': 10, 'Sữa đặc': 25, 'Sữa tươi': 60, 'Đá viên': 150, 'Ly nhựa': 1 }],
  ['Cà phê muối', 'Cà phê', 35000, 8, { 'Cà phê Robusta': 20, 'Sữa đặc': 20, 'Kem whipping': 30, 'Muối hồng': 1, 'Đá viên': 120, 'Ly nhựa': 1 }],
  ['Cappuccino', 'Cà phê', 45000, 4, { 'Cà phê Arabica': 18, 'Sữa tươi': 150, 'Bột cacao': 1 }],
  ['Latte', 'Cà phê', 45000, 4, { 'Cà phê Arabica': 18, 'Sữa tươi': 180 }],
  ['Americano', 'Cà phê', 39000, 1.5, { 'Cà phê Arabica': 18, 'Đá viên': 150, 'Ly nhựa': 1 }],
  ['Trà đào cam sả', 'Trà', 45000, 9, { 'Trà đen': 5, 'Syrup đào': 20, 'Đào ngâm': 2, 'Cam': 0.25, 'Sả': 1, 'Đường': 15, 'Đá viên': 180, 'Ly nhựa': 1 }],
  ['Trà chanh', 'Trà', 25000, 6, { 'Trà đen': 4, 'Chanh': 0.5, 'Đường': 20, 'Đá viên': 180, 'Ly nhựa': 1 }],
  ['Trà ô long sữa', 'Trà', 39000, 5, { 'Trà ô long': 6, 'Sữa tươi': 80, 'Sữa đặc': 15, 'Đá viên': 150, 'Ly nhựa': 1 }],
  ['Matcha latte', 'Trà', 45000, 4, { 'Bột matcha': 4, 'Sữa tươi': 150, 'Đường': 10, 'Đá viên': 120, 'Ly nhựa': 1 }],
  ['Matcha đá xay', 'Đá xay', 55000, 4, { 'Bột matcha': 6, 'Sữa tươi': 100, 'Bột base đá xay': 25, 'Kem whipping': 30, 'Đá viên': 200, 'Ly nhựa': 1 }],
  ['Socola đá xay', 'Đá xay', 55000, 3, { 'Bột cacao': 20, 'Sữa tươi': 100, 'Bột base đá xay': 25, 'Kem whipping': 30, 'Đá viên': 200, 'Ly nhựa': 1 }],
  ['Caramel đá xay', 'Đá xay', 55000, 2.5, { 'Syrup caramel': 25, 'Cà phê Robusta': 10, 'Sữa tươi': 100, 'Bột base đá xay': 25, 'Kem whipping': 30, 'Đá viên': 200, 'Ly nhựa': 1 }],
  ['Nước cam ép', 'Nước ép', 40000, 2, { 'Cam': 3, 'Đường': 10, 'Đá viên': 100, 'Ly nhựa': 1 }],
  ['Chanh tươi', 'Nước ép', 25000, 1, { 'Chanh': 1.5, 'Đường': 25, 'Đá viên': 150, 'Ly nhựa': 1 }],
  ['Bánh croissant', 'Bánh', 30000, 3, { 'Bánh croissant': 1 }],
  ['Bánh tiramisu', 'Bánh', 40000, 2, { 'Bánh tiramisu': 1 }],
  ['Bánh mì que', 'Bánh', 15000, 0.8, { 'Bánh mì que': 1 }],
];

const EMPLOYEES = [
  ['Nguyễn Văn Quản Trị', 'admin', 'admin123', 'admin', '0900000001', 0],
  ['Trần Thị Quản Lý', 'quanly', 'quanly123', 'manager', '0900000002', 40000],
  ['Lê Minh Anh', 'thungan1', '123456', 'cashier', '0900000003', 25000],
  ['Phạm Thu Hà', 'thungan2', '123456', 'cashier', '0900000004', 25000],
  ['Hoàng Đức Huy', 'thungan3', '123456', 'cashier', '0900000005', 25000],
  ['Võ Ngọc Bảo', 'phache1', '123456', 'barista', '0900000006', 27000],
];

// Phân bổ số đơn theo giờ (giờ cao điểm sáng, trưa, tối)
const HOUR_W = { 6: 0.4, 7: 1.7, 8: 2.1, 9: 1.5, 10: 0.9, 11: 0.9, 12: 1.3, 13: 1.1, 14: 0.7, 15: 0.9, 16: 1.0, 17: 1.2, 18: 1.4, 19: 1.7, 20: 1.4, 21: 0.9, 22: 0.4 };

// Nguyên liệu bị "thất thoát" thực tế (rót dư, đổ vỡ, thất thoát) - tỷ lệ trên lượng dùng lý thuyết
const LEAK = { 'Sữa đặc': 0.04, 'Sữa tươi': 0.035, 'Cà phê Robusta': 0.025, 'Kem whipping': 0.06, 'Đường': 0.03, 'Ly nhựa': 0.02, 'Đào ngâm': 0.05 };
// Nguyên liệu cố tình không nhập thêm 1 tuần cuối để minh họa dự báo hết hàng
const NO_RESTOCK_LAST_DAYS = { 'Bột matcha': 9, 'Kem whipping': 7, 'Đào ngâm': 6, 'Bánh tiramisu': 4 };

const DAYS = 75;

function isEmpty() {
  return !get('SELECT 1 FROM employees LIMIT 1');
}

function seed({ days = DAYS, seedValue = 20261127 } = {}) {
  const rnd = mulberry32(seedValue);
  const pick = (arr, weights) => {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rnd() * total;
    for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  };

  transaction((db) => {
    // ---- danh mục, nguyên liệu, món, công thức, nhân viên
    const catId = {};
    CATEGORIES.forEach((c, i) => { catId[c] = Number(db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)').run(c, i).lastInsertRowid); });

    const ing = {};
    for (const [name, unit, cost, min, supplier] of INGREDIENTS) {
      const id = Number(db.prepare('INSERT INTO ingredients (name, unit, stock, min_stock, cost_per_unit, supplier) VALUES (?, ?, 0, ?, ?, ?)')
        .run(name, unit, min, cost, supplier).lastInsertRowid);
      ing[name] = { id, unit, cost, min, stock: 0, real: 0, daily: 0 };
    }

    const prods = PRODUCTS.map(([name, cat, price, weight, recipe]) => {
      const id = Number(db.prepare('INSERT INTO products (name, category_id, price) VALUES (?, ?, ?)').run(name, catId[cat], price).lastInsertRowid);
      let cost = 0;
      for (const [iname, q] of Object.entries(recipe)) {
        db.prepare('INSERT INTO recipes (product_id, ingredient_id, quantity) VALUES (?, ?, ?)').run(id, ing[iname].id, q);
        cost += q * ing[iname].cost;
      }
      return { id, name, price, weight, recipe, cost };
    });

    const emp = {};
    for (const [full, user, pw, role, phone, wage] of EMPLOYEES) {
      emp[user] = Number(db.prepare('INSERT INTO employees (full_name, username, password_hash, role, phone, hourly_wage) VALUES (?, ?, ?, ?, ?, ?)')
        .run(full, user, hashPassword(pw), role, phone, wage).lastInsertRowid);
    }

    // ---- ước lượng lượng dùng/ngày để nhập kho hợp lý
    const avgOrders = 75;
    const itemsPerOrder = 1.5;
    const wTotal = prods.reduce((s, p) => s + p.weight, 0);
    for (const p of prods) {
      for (const [iname, q] of Object.entries(p.recipe)) ing[iname].daily += (avgOrders * itemsPerOrder * p.weight / wTotal) * q;
    }

    const stmt = {
      tx: db.prepare(`INSERT INTO inventory_transactions (ingredient_id, type, quantity, unit_cost, order_id, employee_id, note, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      order: db.prepare(`INSERT INTO orders (code, employee_id, table_no, status, payment_method, subtotal, discount, total, cost_total,
                         note, cancel_reason, created_at, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      item: db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost, status, cancel_reason)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      pay: db.prepare('INSERT INTO payments (order_id, method, amount, status, message, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
      count: db.prepare(`INSERT INTO stock_counts (ingredient_id, system_qty, counted_qty, difference, unit_cost, employee_id, note, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      stockout: db.prepare('INSERT INTO stockout_events (product_id, ingredient_id, employee_id, created_at) VALUES (?, ?, ?, ?)'),
      err: db.prepare('INSERT INTO error_logs (type, message, detail, employee_id, resolved, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    };

    const doImport = (name, qty, at) => {
      const it = ing[name];
      const price = Math.round(it.cost * (0.95 + rnd() * 0.1) * 100) / 100;
      stmt.tx.run(it.id, 'import', qty, price, null, emp.quanly, 'Nhập hàng định kỳ', at);
      it.stock += qty; it.real += qty;
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDay = addDays(today, -days);

    // tồn đầu kỳ: ~12 ngày dùng
    for (const [name, it] of Object.entries(ing)) {
      doImport(name, Math.ceil(it.daily * 12 + it.min), `${fmtDate(addDays(startDay, -1))} 20:00:00`);
    }

    for (let d = 0; d <= days; d++) {
      const day = addDays(startDay, d);
      const ds = fmtDate(day);
      const isToday = d === days;
      const daysToEnd = days - d;
      const wd = day.getDay();

      // nhập hàng buổi sáng khi tồn dưới ~5 ngày dùng
      for (const [name, it] of Object.entries(ing)) {
        if (NO_RESTOCK_LAST_DAYS[name] && daysToEnd <= NO_RESTOCK_LAST_DAYS[name]) continue;
        if (it.stock < it.daily * 5 + it.min) doImport(name, Math.ceil(it.daily * 10 + it.min), `${ds} 06:30:00`);
      }

      // hủy hàng hỏng thỉnh thoảng
      if (rnd() < 0.12) {
        const name = pick(['Sữa tươi', 'Kem whipping', 'Bánh croissant', 'Cam'], [4, 2, 2, 1]);
        const q = { 'Sữa tươi': 1000, 'Kem whipping': 250, 'Bánh croissant': 2, Cam: 3 }[name];
        stmt.tx.run(ing[name].id, 'waste', -q, ing[name].cost, null, emp.quanly, 'Hết hạn sử dụng', `${ds} 22:30:00`);
        ing[name].stock -= q; ing[name].real -= q;
      }

      // số đơn trong ngày: cuối tuần đông hơn + xu hướng tăng dần theo thời gian
      const growth = 0.85 + 0.3 * (d / days);
      const weekend = wd === 0 || wd === 6 ? 1.35 : wd === 5 ? 1.15 : 1;
      const nOrders = Math.round(avgOrders * growth * weekend * (0.85 + rnd() * 0.3));
      const hours = Object.keys(HOUR_W).map(Number);
      const hourW = hours.map((h) => HOUR_W[h] * ((wd === 0 || wd === 6) && h >= 9 && h <= 16 ? 1.3 : 1));
      const times = [];
      for (let i = 0; i < nOrders; i++) {
        const h = pick(hours, hourW);
        times.push(`${ds} ${pad(h)}:${pad(Math.floor(rnd() * 60))}:${pad(Math.floor(rnd() * 60))}`);
      }
      times.sort();

      let seq = 0;
      for (const t of times) {
        const h = Number(t.slice(11, 13));
        if (isToday && h >= now.getHours()) break; // hôm nay chỉ tạo tới giờ hiện tại
        const cashier = h < 12 ? emp.thungan1 : h < 18 ? emp.thungan2 : (rnd() < 0.8 ? emp.thungan3 : emp.quanly);

        // chọn món
        const nItems = rnd() < 0.6 ? 1 : rnd() < 0.75 ? 2 : 3;
        const lines = new Map();
        for (let k = 0; k < nItems; k++) {
          const morningBoost = (p) => (h < 11 && p.recipe['Cà phê Robusta'] ? 1.5 : 1) * (h >= 14 && p.name.includes('đá xay') ? 1.6 : 1);
          const p = pick(prods, prods.map((x) => x.weight * morningBoost(x)));
          lines.set(p.id, (lines.get(p.id) || 0) + (rnd() < 0.12 ? 2 : 1));
        }

        // kiểm tra tồn kho - thiếu nguyên liệu -> sự kiện hết nguyên liệu, bỏ món
        const ok = [];
        for (const [pid, qty] of lines) {
          const p = prods.find((x) => x.id === pid);
          const short = Object.entries(p.recipe).find(([iname, q]) => ing[iname].stock < q * qty);
          if (short) {
            stmt.stockout.run(p.id, ing[short[0]].id, cashier, t);
            if (rnd() < 0.3) {
              stmt.err.run('order', 'Không tạo được đơn: hết nguyên liệu', `${short[0]}: không đủ cho ${p.name}`, cashier, 1, t);
            }
          } else ok.push({ p, qty });
        }
        if (!ok.length) continue;

        seq++;
        const code = `HD${ds.replace(/-/g, '').slice(2)}-${String(seq).padStart(4, '0')}`;
        const cancelOrder = rnd() < 0.012;
        const method = rnd() < (h < 11 ? 0.45 : 0.6) ? 'qr' : 'cash';
        const items = ok.map(({ p, qty }) => ({ p, qty, cancelled: !cancelOrder && rnd() < 0.025 }));
        if (items.every((i) => i.cancelled)) items[0].cancelled = false;
        const live = cancelOrder ? [] : items.filter((i) => !i.cancelled);
        const subtotal = live.reduce((s, i) => s + i.p.price * i.qty, 0);
        const discount = subtotal >= 150000 && rnd() < 0.3 ? 10000 : 0;
        const cost = live.reduce((s, i) => s + Math.round(i.p.cost) * i.qty, 0);
        const paidAt = fmtDateTime(new Date(new Date(t.replace(' ', 'T')).getTime() + 60000 + rnd() * 240000));

        const orderId = Number(stmt.order.run(
          code, cashier, rnd() < 0.55 ? String(1 + Math.floor(rnd() * 15)) : null,
          cancelOrder ? 'cancelled' : 'paid', cancelOrder ? null : method,
          cancelOrder ? items.reduce((s, i) => s + i.p.price * i.qty, 0) : subtotal, discount,
          cancelOrder ? 0 : subtotal - discount, cancelOrder ? 0 : cost, null,
          cancelOrder ? pick(['Khách đợi lâu bỏ về', 'Nhập nhầm đơn', 'Khách đổi ý'], [2, 2, 1]) : null,
          t, cancelOrder ? null : paidAt,
        ).lastInsertRowid);

        for (const i of items) {
          const cancelled = cancelOrder || i.cancelled;
          const reason = cancelOrder ? 'Hủy đơn' : i.cancelled ? pick(['Khách đổi ý', 'Pha sai món', 'Khách đợi lâu'], [3, 1, 1]) : null;
          stmt.item.run(orderId, i.p.id, i.p.name, i.qty, i.p.price, Math.round(i.p.cost), cancelled ? 'cancelled' : 'ok', reason);
          // tiêu hao: món bị hủy do pha sai -> vẫn mất nguyên liệu (không hoàn kho)
          const consumed = !cancelled || reason === 'Pha sai món';
          for (const [iname, q] of Object.entries(i.p.recipe)) {
            const qty = q * i.qty;
            stmt.tx.run(ing[iname].id, 'consume', -qty, ing[iname].cost, orderId, cashier, `Bán đơn ${code}`, t);
            ing[iname].stock -= qty;
            ing[iname].real -= qty * (1 + (LEAK[iname] || 0.005) * (0.5 + rnd()));
            if (!consumed) {
              stmt.tx.run(ing[iname].id, 'return', qty, ing[iname].cost, orderId, cashier, `Hủy món ${i.p.name} - đơn ${code}`, paidAt);
              ing[iname].stock += qty; ing[iname].real += qty;
            }
          }
        }

        if (!cancelOrder) {
          if (method === 'qr' && rnd() < 0.03) {
            stmt.pay.run(orderId, 'qr', subtotal - discount, 'failed', 'Cổng thanh toán QR không phản hồi', t);
            stmt.err.run('payment', `Thanh toán thất bại đơn ${code}`, 'Cổng thanh toán QR không phản hồi / giao dịch bị từ chối', cashier, 1, t);
          }
          stmt.pay.run(orderId, method, subtotal - discount, 'success', null, paidAt);
        }
      }

      // sự cố mất mạng thỉnh thoảng
      if (rnd() < 0.06 && !isToday) {
        stmt.err.run('network', 'Mất kết nối Internet - đã đồng bộ đơn tạo khi offline',
          JSON.stringify({ duration_min: Math.ceil(rnd() * 25) }), emp.thungan2, 1, `${ds} ${pad(12 + Math.floor(rnd() * 6))}:15:00`);
      }

      // kiểm kê cuối ngày Chủ nhật: phát hiện chênh lệch giữa tồn hệ thống và tồn thực tế
      if (wd === 0 && !isToday) {
        const at = `${ds} 23:00:00`;
        for (const it of Object.values(ing)) {
          const counted = Math.max(0, Math.round(it.real * 10) / 10);
          const diff = Math.round((counted - it.stock) * 1000) / 1000;
          stmt.count.run(it.id, Math.round(it.stock * 1000) / 1000, counted, diff, it.cost, emp.quanly, 'Kiểm kê cuối tuần', at);
          if (diff !== 0) stmt.tx.run(it.id, 'adjust', diff, it.cost, null, emp.quanly, 'Điều chỉnh sau kiểm kê', at);
          it.stock = counted; it.real = counted;
        }
      }
    }

    for (const it of Object.values(ing)) {
      db.prepare('UPDATE ingredients SET stock = ? WHERE id = ?').run(Math.round(it.stock * 1000) / 1000, it.id);
    }
    // một vài lỗi chưa xử lý để trang "Bắt lỗi hệ thống" có dữ liệu
    const y = fmtDate(addDays(today, -1));
    stmt.err.run('payment', 'Thanh toán thất bại: QR hết hạn', 'Khách quét mã sau 15 phút', emp.thungan2, 0, `${y} 15:42:10`);
    stmt.err.run('network', 'Mất kết nối Internet 12 phút - 7 đơn được lưu offline và đồng bộ lại', '{"duration_min":12}', emp.thungan3, 0, `${y} 19:05:00`);
  });
}

function seedIfEmpty() {
  if (isEmpty()) {
    console.log('CSDL trống - đang tạo dữ liệu mẫu (vài giây)...');
    seed();
  }
}

if (require.main === module) {
  if (process.argv.includes('--reset')) {
    const p = resolveDbPath();
    closeDb();
    for (const f of [p, `${p}-wal`, `${p}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
    console.log('Đã xóa CSDL cũ:', p);
  }
  getDb();
  const t = Date.now();
  if (isEmpty()) seed();
  const n = get('SELECT COUNT(*) AS n FROM orders').n;
  console.log(`Xong (${Date.now() - t}ms). Tổng số đơn: ${n}`);
  closeDb();
}

module.exports = { seed, seedIfEmpty };
