/* Trang báo cáo & phân tích dữ liệu */
(function () {
  const user = UI.init({ title: 'Báo cáo & phân tích', roles: ['admin', 'manager'] });
  if (!user) return;
  const { esc, money, num, pct, table, delta, toast, showError } = UI;
  const $ = (s) => document.querySelector(s);
  let rep = null;
  let hmMetric = 'orders';

  /* ---------------- Bộ lọc thời gian ---------------- */
  function setPreset(p) {
    const t = UI.today();
    const d = new Date();
    let from = t; let to = t;
    if (p === '7') from = UI.dateAdd(t, -6);
    else if (p === '30') from = UI.dateAdd(t, -29);
    else if (p === 'month') from = new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv-SE');
    else if (p === 'lastmonth') {
      from = new Date(d.getFullYear(), d.getMonth() - 1, 1).toLocaleDateString('sv-SE');
      to = new Date(d.getFullYear(), d.getMonth(), 0).toLocaleDateString('sv-SE');
    }
    $('#from').value = from; $('#to').value = to;
    document.querySelectorAll('#presets .chip').forEach((c) => c.classList.toggle('active', c.dataset.p === p));
    load();
  }
  document.querySelectorAll('#presets .chip').forEach((c) => { c.onclick = () => setPreset(c.dataset.p); });
  ['#from', '#to'].forEach((s) => { $(s).onchange = () => { document.querySelectorAll('#presets .chip').forEach((c) => c.classList.remove('active')); load(); }; });
  $('#group').onchange = load;

  const qs = () => `from=${$('#from').value}&to=${$('#to').value}&group=${$('#group').value}`;

  $('#btn-xlsx').onclick = async () => {
    try { toast('Đang tạo file Excel...'); await Api.download(`/api/export/report.xlsx?${qs()}`, `bao-cao_${$('#from').value}_${$('#to').value}.xlsx`); } catch (e) { showError(e); }
  };
  $('#btn-pdf').onclick = async () => {
    try { toast('Đang tạo file PDF...'); await Api.download(`/api/export/report.pdf?${qs()}`, `bao-cao_${$('#from').value}_${$('#to').value}.pdf`); } catch (e) { showError(e); }
  };

  /* ---------------- Tabs ---------------- */
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
      if (rep) render(); // vẽ lại để Chart.js đo đúng kích thước
    };
  });
  document.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = () => {
      const t = $(`#t-${b.dataset.toggle}`);
      t.classList.toggle('hidden');
      b.textContent = t.classList.contains('hidden') ? 'Xem bảng' : 'Ẩn bảng';
    };
  });
  document.querySelectorAll('[data-hm]').forEach((b) => {
    b.onclick = async () => {
      hmMetric = b.dataset.hm;
      document.querySelectorAll('[data-hm]').forEach((x) => x.classList.toggle('active', x === b));
      try {
        const hm = await Api.get(`/api/reports/heatmap?${qs()}&metric=${hmMetric}`);
        Charts.heatmap($('#hm'), hm, { money: hmMetric === 'revenue' });
      } catch (e) { showError(e); }
    };
  });

  /* ---------------- Tải & hiển thị ---------------- */
  async function load() {
    try {
      $('#kpis').innerHTML = '<div class="muted">Đang tải...</div>';
      rep = await Api.get(`/api/reports/full?${qs()}`);
      if (hmMetric === 'revenue') rep.heatmap = await Api.get(`/api/reports/heatmap?${qs()}&metric=revenue`);
      render();
    } catch (e) {
      showError(e, 'Không tải được báo cáo');
      $('#kpis').innerHTML = `<div class="card">${e.network ? '📡 Mất mạng — báo cáo cần kết nối tới máy chủ.' : esc(e.message)}</div>`;
    }
  }

  const STATUS = {
    out: '<span class="badge critical">✖ Đã hết</span>', critical: '<span class="badge critical">⛔ Nguy cấp</span>',
    warning: '<span class="badge warning">⚠ Sắp hết</span>', ok: '<span class="badge good">✔ Ổn định</span>',
  };

  function kpi(label, value, change, opts) {
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${change === false ? '' : delta(change, opts)}</div>`;
  }

  function render() {
    const s = rep.summary;
    const groupLabel = { day: 'ngày', week: 'tuần', month: 'tháng' }[$('#group').value];
    $('#range-note').textContent = `Kỳ này: ${s.range.from} → ${s.range.to} (${s.range.days} ngày) · so sánh với kỳ trước: ${s.previous_range.from} → ${s.previous_range.to}`;
    $('#kpis').innerHTML = [
      kpi('Doanh thu', money(s.current.revenue), s.change.revenue),
      kpi('Số đơn', num(s.current.orders), s.change.orders),
      kpi('Giá trị TB / đơn', money(s.current.avg_order), s.change.avg_order),
      kpi('Lợi nhuận gộp', money(s.current.profit), s.change.profit),
      kpi('Biên lợi nhuận', pct(s.current.margin), false),
      kpi('Món bán ra', num(s.current.items_sold), s.change.items_sold),
    ].join('');

    // Doanh thu theo thời gian: 2 chuỗi cùng đơn vị tiền -> 1 trục
    $('#ts-title').textContent = `Doanh thu & lợi nhuận theo ${groupLabel}`;
    const ts = rep.timeseries;
    $('#ts-legend').innerHTML = '';
    Charts.line('c-ts', ts.map((t) => t.period), [
      { label: 'Doanh thu', data: ts.map((t) => t.revenue) },
      { label: 'Lợi nhuận gộp', data: ts.map((t) => t.profit), color: 2 },
    ]);
    table($('#t-ts'), [
      { key: 'period', label: 'Kỳ' }, { key: 'orders', label: 'Số đơn', type: 'num' },
      { key: 'revenue', label: 'Doanh thu', type: 'money' }, { key: 'profit', label: 'Lợi nhuận', type: 'money' },
      { key: 'change', label: `So với ${groupLabel} trước`, render: (r) => (r.change === null ? '—' : `${r.change > 0 ? '▲' : r.change < 0 ? '▼' : ''} ${pct(Math.abs(r.change))}`), sortValue: (r) => r.change ?? -1e9 },
    ], ts);

    // Thanh toán
    Charts.bar('c-pay', rep.payment.map((p) => p.label), rep.payment.map((p) => p.revenue), { horizontal: true, label: 'Doanh thu' });
    table($('#t-pay'), [
      { key: 'label', label: 'Phương thức' }, { key: 'orders', label: 'Số đơn', type: 'num' },
      { key: 'revenue', label: 'Doanh thu', type: 'money' }, { key: 'share', label: 'Tỷ trọng', type: 'pct' },
      { key: 'failed', label: 'GD lỗi', type: 'num' },
    ], rep.payment);

    // Danh mục
    Charts.bar('c-cat', rep.category.map((c) => c.name), rep.category.map((c) => c.revenue), { horizontal: true, label: 'Doanh thu' });
    table($('#t-cat'), [
      { key: 'name', label: 'Danh mục' }, { key: 'qty', label: 'SL bán', type: 'num' },
      { key: 'revenue', label: 'Doanh thu', type: 'money' }, { key: 'profit', label: 'Lợi nhuận', type: 'money' },
      { key: 'share', label: 'Tỷ trọng', type: 'pct' },
    ], rep.category);

    // Sản phẩm
    const pcols = [
      { key: 'name', label: 'Món' }, { key: 'category', label: 'Danh mục' },
      { key: 'qty', label: 'SL bán', type: 'num', bar: true }, { key: 'revenue', label: 'Doanh thu', type: 'money' },
    ];
    table($('#t-best'), pcols, rep.top.best);
    table($('#t-worst'), pcols, rep.top.worst);
    table($('#t-profit'), [
      { key: 'name', label: 'Món' }, { key: 'category', label: 'Danh mục' },
      { key: 'price', label: 'Giá bán', type: 'money' }, { key: 'unit_cost', label: 'Giá vốn', type: 'money' },
      { key: 'unit_profit', label: 'LN / ly', type: 'money' },
      { key: 'unit_margin', label: 'Biên LN', render: (r) => `${pct(r.unit_margin)} ${r.unit_margin < 50 ? '<span class="badge warning">⚠ thấp</span>' : ''}`, sortValue: (r) => r.unit_margin },
      { key: 'qty', label: 'SL bán', type: 'num' }, { key: 'profit', label: 'Tổng lợi nhuận', type: 'money', bar: true },
    ], rep.profit);

    // Ca & thu ngân
    Charts.bar('c-shift', rep.shift.map((x) => x.label), rep.shift.map((x) => x.revenue), { label: 'Doanh thu' });
    table($('#t-shift'), [
      { key: 'label', label: 'Ca' }, { key: 'orders', label: 'Số đơn', type: 'num' },
      { key: 'revenue', label: 'Doanh thu', type: 'money' }, { key: 'profit', label: 'Lợi nhuận', type: 'money' },
      { key: 'avg_order', label: 'TB / đơn', type: 'money' },
    ], rep.shift);
    Charts.bar('c-cashier', rep.cashier.map((x) => x.name), rep.cashier.map((x) => x.revenue), { horizontal: true, label: 'Doanh thu' });
    table($('#t-cashier'), [
      { key: 'name', label: 'Thu ngân' }, { key: 'orders', label: 'Số đơn', type: 'num' },
      { key: 'revenue', label: 'Doanh thu', type: 'money' }, { key: 'cash', label: 'Tiền mặt', type: 'money' },
      { key: 'qr', label: 'QR', type: 'money' }, { key: 'cancelled', label: 'Đơn hủy', type: 'num' },
    ], rep.cashier);

    // Thất thoát
    const L = rep.loss;
    $('#loss-kpis').innerHTML = [
      kpi('Giá trị NL dùng theo lý thuyết', money(L.total_theoretical_value), false),
      kpi('Giá trị thất thoát', money(L.total_loss_value), false),
      kpi('Tỷ lệ thất thoát', pct(L.loss_rate), false),
    ].join('');
    table($('#t-loss'), [
      { key: 'name', label: 'Nguyên liệu' }, { key: 'unit', label: 'ĐVT' },
      { key: 'theoretical', label: 'Lý thuyết', type: 'num' }, { key: 'actual', label: 'Thực tế', type: 'num' },
      { key: 'wasted', label: 'Hủy / hỏng', type: 'num' }, { key: 'count_diff', label: 'Thiếu khi kiểm kê', type: 'num' },
      { key: 'loss_pct', label: 'Thất thoát %', render: (r) => `${pct(r.loss_pct)} ${r.loss_pct > 3 ? '<span class="badge serious">⚠ kiểm tra</span>' : ''}`, sortValue: (r) => r.loss_pct },
      { key: 'loss_value', label: 'Giá trị thất thoát', type: 'money', bar: true },
    ], L.rows);
    table($('#t-usage'), [
      { key: 'name', label: 'Nguyên liệu' }, { key: 'unit', label: 'ĐVT' },
      { key: 'used', label: 'Đã dùng', type: 'num' }, { key: 'avg_per_day', label: 'TB / ngày', type: 'num' },
      { key: 'used_value', label: 'Giá trị tiêu hao', type: 'money', bar: true },
      { key: 'imported', label: 'Đã nhập', type: 'num' }, { key: 'wasted', label: 'Hủy', type: 'num' }, { key: 'stock', label: 'Tồn hiện tại', type: 'num' },
    ], rep.usage);

    // Nâng cao
    Charts.heatmap($('#hm'), rep.heatmap, { money: hmMetric === 'revenue' });
    const C = rep.cancel;
    $('#cancel-kpis').innerHTML = [
      kpi('Tỷ lệ món bị hủy', pct(C.total.cancel_rate), false),
      kpi('Số món bị hủy', num(C.total.cancelled), false),
      kpi('Tỷ lệ hết nguyên liệu', pct(C.total.stockout_rate), false),
      kpi('Lần khách gọi mà hết NL', num(C.total.stockouts), false),
    ].join('');
    table($('#t-cancel'), [
      { key: 'name', label: 'Món' }, { key: 'ordered', label: 'Đã gọi', type: 'num' },
      { key: 'cancelled', label: 'Bị hủy', type: 'num' }, { key: 'cancel_rate', label: 'Tỷ lệ hủy', type: 'pct' },
      { key: 'stockouts', label: 'Hết NL', type: 'num' }, { key: 'stockout_rate', label: 'Tỷ lệ hết NL', type: 'pct' },
    ], C.rows.slice(0, 15));
    table($('#t-reasons'), [{ key: 'reason', label: 'Lý do' }, { key: 'qty', label: 'Số món', type: 'num', bar: true }], C.reasons);
    table($('#t-forecast'), [
      { key: 'name', label: 'Nguyên liệu' }, { key: 'stock', label: 'Tồn', render: (r) => `${num(r.stock)} ${esc(r.unit)}`, sortValue: (r) => r.stock },
      { key: 'daily_usage', label: 'Dùng / ngày', type: 'num' },
      { key: 'days_left', label: 'Còn đủ (ngày)', type: 'num' }, { key: 'stockout_date', label: 'Dự kiến hết' },
      { key: 'status', label: 'Trạng thái', render: (r) => STATUS[r.status], sortValue: (r) => ({ out: 0, critical: 1, warning: 2, ok: 3 }[r.status]) },
    ], rep.forecast.filter((f) => f.status !== 'ok').slice(0, 10), { empty: 'Tất cả nguyên liệu đều đủ dùng trên 7 ngày ✔' });
  }

  setPreset('30');
})();
