/**
 * Kiểm thử tích hợp API: chạy `npm test` trong thư mục backend.
 * Dùng CSDL trong bộ nhớ (:memory:) với dữ liệu mẫu, không ảnh hưởng dữ liệu thật.
 */
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.ANTHROPIC_API_KEY = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { get, run } = require('../src/config/db');

let server; let base; const tokens = {};

async function call(method, url, body, who = 'admin') {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, type };
}

test.before(async () => {
  const app = createApp();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [who, u, p] of [['admin', 'admin', 'admin123'], ['cashier', 'thungan1', '123456'], ['barista', 'phache1', '123456']]) {
    const r = await call('POST', '/api/auth/login', { username: u, password: p }, null);
    assert.equal(r.status, 200);
    tokens[who] = r.data.token;
  }
});
test.after(() => server.close());

const productByName = (n) => get('SELECT * FROM products WHERE name = ?', n);
const stockOf = (n) => get('SELECT stock FROM ingredients WHERE name = ?', n).stock;

test('đăng nhập sai bị từ chối, thiếu token bị chặn', async () => {
  assert.equal((await call('POST', '/api/auth/login', { username: 'admin', password: 'sai' }, null)).status, 401);
  assert.equal((await call('GET', '/api/products', null, null)).status, 401);
});

test('phân quyền: thu ngân không xem được báo cáo / nhân viên', async () => {
  assert.equal((await call('GET', '/api/reports/summary', null, 'cashier')).status, 403);
  assert.equal((await call('GET', '/api/employees', null, 'cashier')).status, 403);
  assert.equal((await call('POST', '/api/orders', { items: [] }, 'barista')).status, 403);
});

test('tạo đơn trừ kho theo công thức, thanh toán tiền mặt', async () => {
  const p = productByName('Cà phê sữa đá');
  const before = stockOf('Sữa đặc');
  const r = await call('POST', '/api/orders', { items: [{ product_id: p.id, quantity: 2 }], table_no: '3' }, 'cashier');
  assert.equal(r.status, 201);
  assert.equal(r.data.total, 58000);
  assert.equal(r.data.status, 'pending');
  assert.ok(Math.abs(before - stockOf('Sữa đặc') - 60) < 1e-6, 'trừ 2 x 30ml sữa đặc');

  const low = await call('POST', `/api/orders/${r.data.id}/pay`, { method: 'cash', received: 50000 }, 'cashier');
  assert.equal(low.status, 400, 'tiền khách đưa thiếu');
  const paid = await call('POST', `/api/orders/${r.data.id}/pay`, { method: 'cash', received: 100000 }, 'cashier');
  assert.equal(paid.status, 200);
  assert.equal(paid.data.status, 'paid');
  assert.equal(paid.data.change, 42000);
  assert.equal((await call('POST', `/api/orders/${r.data.id}/pay`, { method: 'cash' }, 'cashier')).status, 409, 'không thanh toán 2 lần');
});

test('hết nguyên liệu: trả 409, ghi sự kiện stockout và nhật ký lỗi', async () => {
  const p = productByName('Matcha latte');
  run("UPDATE ingredients SET stock = 0 WHERE name = 'Bột matcha'");
  const before = get('SELECT COUNT(*) n FROM stockout_events WHERE product_id = ?', p.id).n;
  const r = await call('POST', '/api/orders', { items: [{ product_id: p.id, quantity: 1 }] }, 'cashier');
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'OUT_OF_STOCK');
  assert.equal(r.data.shortages[0].ingredient, 'Bột matcha');
  assert.equal(get('SELECT COUNT(*) n FROM stockout_events WHERE product_id = ?', p.id).n, before + 1);
  assert.ok(get("SELECT 1 FROM error_logs WHERE type='order' AND resolved=0"));
});

test('thanh toán QR lỗi: đơn vẫn chờ, ghi lỗi, thử lại thành công', async () => {
  const p = productByName('Bạc xỉu');
  const o = (await call('POST', '/api/orders', { items: [{ product_id: p.id, quantity: 1 }] }, 'cashier')).data;
  const qr = await call('GET', `/api/orders/${o.id}/qr`, null, 'cashier');
  assert.ok(qr.data.qr.startsWith('data:image/png;base64,'));
  const fail = await call('POST', `/api/orders/${o.id}/pay`, { method: 'qr', simulate_failure: true }, 'cashier');
  assert.equal(fail.status, 402);
  assert.equal(get('SELECT status FROM orders WHERE id = ?', o.id).status, 'pending');
  assert.ok(get("SELECT 1 FROM payments WHERE order_id = ? AND status = 'failed'", o.id));
  const ok = await call('POST', `/api/orders/${o.id}/pay`, { method: 'qr' }, 'cashier');
  assert.equal(ok.status, 200);
  assert.equal(ok.data.payment_method, 'qr');
});

test('hủy món / hủy đơn hoàn nguyên liệu về kho, không hoàn 2 lần', async () => {
  const a = productByName('Cà phê đen đá');
  const b = productByName('Trà chanh');
  const before = stockOf('Ly nhựa');
  const o = (await call('POST', '/api/orders', { items: [{ product_id: a.id, quantity: 1 }, { product_id: b.id, quantity: 1 }] }, 'cashier')).data;
  assert.equal(before - stockOf('Ly nhựa'), 2);
  const item = o.items.find((i) => i.product_id === b.id);
  const c1 = await call('POST', `/api/orders/${o.id}/items/${item.id}/cancel`, { reason: 'Khách đổi ý' }, 'cashier');
  assert.equal(c1.data.total, 25000);
  assert.equal(before - stockOf('Ly nhựa'), 1);
  const c2 = await call('POST', `/api/orders/${o.id}/cancel`, { reason: 'Khách bỏ về' }, 'cashier');
  assert.equal(c2.data.status, 'cancelled');
  assert.equal(stockOf('Ly nhựa'), before, 'hoàn đủ, không dư');
});

test('đồng bộ đơn offline: tạo đơn đã thanh toán, gửi lại không bị trùng', async () => {
  const p = productByName('Cà phê sữa đá');
  const order = { client_uuid: 'test-offline-1', items: [{ product_id: p.id, quantity: 1 }], payment_method: 'cash', created_at: '2026-01-01 08:15:00' };
  const r1 = await call('POST', '/api/orders/sync', { orders: [order] }, 'cashier');
  assert.equal(r1.data.synced, 1);
  const r2 = await call('POST', '/api/orders/sync', { orders: [order] }, 'cashier');
  assert.equal(r2.data.synced, 0);
  assert.equal(r2.data.results[0].duplicate, true);
  const row = get("SELECT * FROM orders WHERE client_uuid = 'test-offline-1'");
  assert.equal(row.status, 'paid');
  assert.equal(row.offline, 1);
  assert.equal(row.created_at, '2026-01-01 08:15:00');
  assert.ok(get("SELECT 1 FROM error_logs WHERE type='network'"));
});

test('kiểm kê ghi nhận thất thoát và điều chỉnh tồn', async () => {
  const ing = get("SELECT * FROM ingredients WHERE name = 'Sữa tươi'");
  const r = await call('POST', '/api/inventory/count', { counts: [{ ingredient_id: ing.id, counted_qty: ing.stock - 500 }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.results[0].difference, -500);
  assert.equal(stockOf('Sữa tươi'), ing.stock - 500);
});

test('nhập hàng cập nhật giá vốn bình quân', async () => {
  const id = (await call('POST', '/api/ingredients', { name: 'NL test', unit: 'g', stock: 100, cost_per_unit: 10 })).data.id;
  await call('POST', '/api/inventory/import', { items: [{ ingredient_id: id, quantity: 100, unit_cost: 20 }] });
  const ing = get('SELECT * FROM ingredients WHERE id = ?', id);
  assert.equal(ing.stock, 200);
  assert.equal(ing.cost_per_unit, 15);
});

test('các báo cáo trả dữ liệu hợp lệ', async () => {
  const names = ['summary', 'timeseries', 'payment', 'shift', 'cashier', 'top', 'profit', 'category', 'usage', 'loss', 'forecast', 'cancel', 'heatmap', 'full'];
  for (const n of names) {
    const r = await call('GET', `/api/reports/${n}?group=week`);
    assert.equal(r.status, 200, n);
  }
  const s = (await call('GET', '/api/reports/summary')).data;
  assert.ok(s.current.revenue > 0 && s.previous.revenue > 0);
  assert.equal(typeof s.change.revenue, 'number');
  const hm = (await call('GET', '/api/reports/heatmap')).data;
  assert.equal(hm.matrix.length, 7);
  assert.equal(hm.matrix[0].length, 18);
  const pay = (await call('GET', '/api/reports/payment')).data;
  assert.deepEqual(pay.map((p) => p.method), ['cash', 'qr']);
  const profit = (await call('GET', '/api/reports/profit')).data;
  const cfs = profit.find((p) => p.name === 'Cà phê sữa đá');
  assert.ok(cfs.unit_cost > 0 && cfs.unit_profit === cfs.price - cfs.unit_cost);
});

test('xuất Excel và PDF', async () => {
  const x = await call('GET', '/api/export/report.xlsx');
  assert.equal(x.status, 200);
  assert.equal(x.data.subarray(0, 2).toString(), 'PK');
  const p = await call('GET', '/api/export/report.pdf');
  assert.equal(p.status, 200);
  assert.equal(p.data.subarray(0, 5).toString(), '%PDF-');
});

test('dự báo nguồn cung (bộ phân tích từ khóa, không cần mạng)', async () => {
  const r = await call('POST', '/api/forecast/supply', { text: 'Giá cà phê Robusta tăng mạnh, lập đỉnh kỷ lục do hạn hán\nGiá sữa giảm nhẹ do dư thừa nguồn cung', fetch: false });
  assert.equal(r.status, 200);
  assert.equal(r.data.engine, 'keyword');
  const coffee = r.data.commodities.find((c) => c.key === 'coffee');
  assert.equal(coffee.trend, 'up');
  assert.ok(r.data.recommendations.length > 0);
});

test('lỗi máy chủ được ghi vào nhật ký lỗi', async () => {
  const r = await call('POST', '/api/errors/client', { errors: [{ type: 'network', message: 'Mất mạng 5 phút' }] }, 'cashier');
  assert.equal(r.status, 200);
  const logs = (await call('GET', '/api/errors?type=network')).data;
  assert.ok(logs.rows.some((l) => l.message === 'Mất mạng 5 phút'));
});
