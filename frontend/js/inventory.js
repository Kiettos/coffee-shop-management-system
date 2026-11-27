(function () {
  const user = UI.init({ title: 'Kho nguyên liệu', roles: ['admin', 'manager', 'cashier', 'barista'] });
  if (!user) return;
  const { esc, money, num, table, toast, modal, showError, confirmDialog } = UI;
  const $ = (s) => document.querySelector(s);
  const isManager = ['admin', 'manager'].includes(user.role);
  if (!isManager) document.querySelectorAll('[data-manager]').forEach((e) => e.classList.add('hidden'));

  const LEVEL = {
    ok: '<span class="badge good">✔ Đủ</span>', low: '<span class="badge warning">⚠ Dưới định mức</span>', out: '<span class="badge critical">✖ Hết</span>',
  };
  const TX = { import: '📥 Nhập', consume: '☕ Bán', return: '↩ Hoàn', waste: '🗑 Hủy', adjust: '⚖ Kiểm kê' };
  let items = [];
  let level = '';

  async function load() {
    try { items = await Api.get('/api/ingredients'); } catch (e) { return showError(e); }
    $('#i-kpis').innerHTML = `
      <div class="kpi"><div class="label">Số nguyên liệu</div><div class="value">${items.length}</div></div>
      <div class="kpi"><div class="label">Giá trị tồn kho</div><div class="value">${money(items.reduce((s, i) => s + Math.max(i.stock, 0) * i.cost_per_unit, 0))}</div></div>
      <div class="kpi"><div class="label">⚠ Dưới định mức</div><div class="value">${items.filter((i) => i.level === 'low').length}</div></div>
      <div class="kpi"><div class="label">✖ Hết hàng</div><div class="value">${items.filter((i) => i.level === 'out').length}</div></div>`;
    $('#tx-ing').innerHTML = '<option value="">Tất cả nguyên liệu</option>' + items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
    renderStock();
    renderCount();
  }

  function renderStock() {
    const q = $('#q').value.trim().toLowerCase();
    const rows = items.filter((i) => (!level || i.level === level) && (!q || i.name.toLowerCase().includes(q)));
    table($('#t-stock'), [
      { key: 'name', label: 'Nguyên liệu' },
      { key: 'stock', label: 'Tồn kho', render: (i) => `<b>${num(i.stock)}</b> ${esc(i.unit)}`, sortValue: (i) => i.stock },
      { key: 'min_stock', label: 'Định mức tối thiểu', render: (i) => `${num(i.min_stock)} ${esc(i.unit)}`, sortValue: (i) => i.min_stock },
      { key: 'level', label: 'Trạng thái', render: (i) => LEVEL[i.level], sortValue: (i) => ({ out: 0, low: 1, ok: 2 }[i.level]) },
      { key: 'cost_per_unit', label: 'Giá vốn / ĐV', render: (i) => `${num(i.cost_per_unit)}đ/${esc(i.unit)}`, sortValue: (i) => i.cost_per_unit },
      { key: 'value', label: 'Giá trị tồn', render: (i) => money(Math.max(i.stock, 0) * i.cost_per_unit), sortValue: (i) => i.stock * i.cost_per_unit },
      { key: 'supplier', label: 'Nhà cung cấp' },
      { key: 'used_in', label: 'Dùng trong (món)', type: 'num' },
      { key: 'id', label: '', sort: false, cls: 'actions', render: (i) => `
        ${isManager ? `<button class="btn-sm btn-primary" data-imp="${i.id}">Nhập</button> ` : ''}
        <button class="btn-sm" data-waste="${i.id}">Hủy hỏng</button>
        ${isManager ? ` <button class="btn-sm" data-edit="${i.id}">Sửa</button>` : ''}` },
    ], rows);
    document.querySelectorAll('[data-imp]').forEach((b) => { b.onclick = () => importDialog(Number(b.dataset.imp)); });
    document.querySelectorAll('[data-waste]').forEach((b) => { b.onclick = () => wasteDialog(items.find((i) => i.id === Number(b.dataset.waste))); });
    document.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editDialog(items.find((i) => i.id === Number(b.dataset.edit))); });
  }

  function editDialog(ing) {
    const isNew = !ing;
    ing = ing || { name: '', unit: 'g', min_stock: 0, cost_per_unit: 0, supplier: '' };
    const m = modal({
      title: isNew ? 'Thêm nguyên liệu' : `Sửa: ${ing.name}`,
      body: `<div class="field"><label>Tên nguyên liệu</label><input id="f-name" value="${esc(ing.name)}"></div>
        <div class="row"><div class="field"><label>Đơn vị tính</label><input id="f-unit" value="${esc(ing.unit)}" placeholder="g, ml, cái..."></div>
        <div class="field"><label>Định mức tối thiểu</label><input id="f-min" type="number" min="0" value="${ing.min_stock}"></div></div>
        <div class="row"><div class="field"><label>Giá vốn / 1 đơn vị (đ)</label><input id="f-cost" type="number" min="0" step="0.01" value="${ing.cost_per_unit}"></div>
        ${isNew ? '<div class="field"><label>Tồn đầu kỳ</label><input id="f-stock" type="number" min="0" value="0"></div>' : ''}</div>
        <div class="field"><label>Nhà cung cấp</label><input id="f-sup" value="${esc(ing.supplier || '')}"></div>`,
      foot: `${!isNew ? '<button class="btn-danger" data-a="del" style="margin-right:auto">Xóa</button>' : ''}<button data-a="no">Hủy</button><button class="btn-primary" data-a="ok">Lưu</button>`,
    });
    m.$('[data-a=no]').onclick = m.close;
    m.$('[data-a=ok]').onclick = async () => {
      const body = { name: m.$('#f-name').value, unit: m.$('#f-unit').value, min_stock: m.$('#f-min').value, cost_per_unit: m.$('#f-cost').value, supplier: m.$('#f-sup').value };
      if (isNew) body.stock = m.$('#f-stock').value;
      try {
        if (isNew) await Api.post('/api/ingredients', body); else await Api.put(`/api/ingredients/${ing.id}`, body);
        toast('Đã lưu', 'success'); m.close(); load();
      } catch (e) { showError(e); }
    };
    const del = m.$('[data-a=del]');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog(`Xóa nguyên liệu "${ing.name}"?`, { danger: true, ok: 'Xóa' }))) return;
      try { await Api.del(`/api/ingredients/${ing.id}`); toast('Đã xóa', 'success'); m.close(); load(); } catch (e) { showError(e); }
    };
  }

  function importDialog(preselect) {
    const opts = (sel) => items.map((i) => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)} (${esc(i.unit)})</option>`).join('');
    const rowHtml = (sel) => `<div class="recipe-row" style="grid-template-columns:1fr 100px 110px 40px">
      <select class="r-ing">${opts(sel)}</select><input class="r-qty" type="number" min="0" placeholder="SL">
      <input class="r-cost" type="number" min="0" step="0.01" placeholder="Đơn giá"><button class="btn-sm r-del" aria-label="Xóa dòng">✕</button></div>`;
    const m = modal({
      title: '📥 Phiếu nhập hàng', wide: true,
      body: `<p class="muted small">Để trống đơn giá để dùng giá vốn hiện tại. Giá vốn sẽ được cập nhật theo phương pháp bình quân gia quyền.</p>
        <div class="recipe-row muted small" style="grid-template-columns:1fr 100px 110px 40px"><b>Nguyên liệu</b><b>Số lượng</b><b>Đơn giá (đ)</b><span></span></div>
        <div id="rows">${rowHtml(preselect)}</div>
        <button class="btn-sm" id="add-row">➕ Thêm dòng</button>
        <div class="field section-gap"><label>Ghi chú</label><input id="note" placeholder="VD: Nhập từ NCC ABC, hóa đơn số..."></div>`,
      foot: '<button data-a="no">Hủy</button><button class="btn-primary" data-a="ok">Lưu phiếu nhập</button>',
    });
    const bindDel = () => m.$$('.r-del').forEach((b) => { b.onclick = () => b.parentElement.remove(); });
    const showCost = () => m.$$('.recipe-row .r-ing').forEach((s) => {
      const c = s.parentElement.querySelector('.r-cost');
      c.placeholder = `${num(items.find((i) => i.id === Number(s.value))?.cost_per_unit)}`;
      s.onchange = showCost;
    });
    m.$('#add-row').onclick = () => { m.$('#rows').insertAdjacentHTML('beforeend', rowHtml()); bindDel(); showCost(); };
    bindDel(); showCost();
    m.$('[data-a=no]').onclick = m.close;
    m.$('[data-a=ok]').onclick = async () => {
      const list = [...m.$$('#rows .recipe-row')].map((r) => ({
        ingredient_id: Number(r.querySelector('.r-ing').value), quantity: Number(r.querySelector('.r-qty').value),
        unit_cost: r.querySelector('.r-cost').value,
      })).filter((x) => x.quantity > 0);
      if (!list.length) return toast('Nhập số lượng cho ít nhất 1 dòng', 'warn');
      try { await Api.post('/api/inventory/import', { items: list, note: m.$('#note').value || undefined }); toast(`Đã nhập ${list.length} nguyên liệu`, 'success'); m.close(); load(); } catch (e) { showError(e); }
    };
  }

  function wasteDialog(ing) {
    const m = modal({
      title: `🗑 Hủy hàng hỏng: ${ing.name}`,
      body: `<div class="field"><label>Số lượng hủy (${esc(ing.unit)}) — tồn hiện tại ${num(ing.stock)}</label><input id="qty" type="number" min="0"></div>
        <div class="field"><label>Lý do</label><select id="note"><option>Hết hạn sử dụng</option><option>Đổ vỡ</option><option>Hư hỏng / biến chất</option><option>Pha thử / đào tạo</option></select></div>`,
      foot: '<button data-a="no">Hủy</button><button class="btn-danger" data-a="ok">Xác nhận hủy hàng</button>',
    });
    m.$('[data-a=no]').onclick = m.close;
    m.$('[data-a=ok]').onclick = async () => {
      try { await Api.post('/api/inventory/waste', { ingredient_id: ing.id, quantity: Number(m.$('#qty').value), note: m.$('#note').value }); toast('Đã ghi nhận hủy hàng', 'success'); m.close(); load(); } catch (e) { showError(e); }
    };
  }

  /* ---------------- Kiểm kê ---------------- */
  function renderCount() {
    $('#t-count').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Nguyên liệu</th><th class="num">Tồn hệ thống</th><th>Số đếm thực tế</th><th class="num">Chênh lệch</th><th class="num">Giá trị</th></tr></thead><tbody>
      ${items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${num(i.stock)} ${esc(i.unit)}</td>
        <td style="max-width:160px"><input type="number" min="0" step="any" data-count="${i.id}" placeholder="${esc(i.unit)}"></td>
        <td class="num" id="diff-${i.id}">—</td><td class="num" id="val-${i.id}">—</td></tr>`).join('')}</tbody></table></div>`;
    document.querySelectorAll('[data-count]').forEach((inp) => {
      inp.oninput = () => {
        const i = items.find((x) => x.id === Number(inp.dataset.count));
        if (inp.value === '') { $(`#diff-${i.id}`).textContent = '—'; $(`#val-${i.id}`).textContent = '—'; return; }
        const d = Number(inp.value) - i.stock;
        $(`#diff-${i.id}`).innerHTML = `<b style="color:${d < 0 ? '#b42b2c' : d > 0 ? '#006c10' : ''}">${d > 0 ? '+' : ''}${num(d)} ${esc(i.unit)}</b>`;
        $(`#val-${i.id}`).textContent = money(d * i.cost_per_unit);
      };
    });
  }
  $('#btn-count-save').onclick = async () => {
    const counts = [...document.querySelectorAll('[data-count]')].filter((i) => i.value !== '').map((i) => ({ ingredient_id: Number(i.dataset.count), counted_qty: Number(i.value) }));
    if (!counts.length) return toast('Chưa nhập số đếm nào', 'warn');
    if (!(await confirmDialog(`Lưu kết quả kiểm kê ${counts.length} nguyên liệu? Tồn kho hệ thống sẽ được điều chỉnh theo số thực tế.`))) return;
    try {
      const r = await Api.post('/api/inventory/count', { counts, note: 'Kiểm kê' });
      const loss = r.results.reduce((s, x) => s + Math.min(x.value, 0), 0);
      modal({
        title: '⚖ Kết quả kiểm kê',
        body: `<p>Tổng giá trị thất thoát phát hiện: <b style="color:#b42b2c">${money(-loss)}</b></p>
          <div class="table-wrap"><table><thead><tr><th>Nguyên liệu</th><th class="num">Hệ thống</th><th class="num">Thực tế</th><th class="num">Chênh lệch</th><th class="num">Giá trị</th></tr></thead><tbody>
          ${r.results.map((x) => `<tr><td>${esc(x.ingredient)}</td><td class="num">${num(x.system_qty)}</td><td class="num">${num(x.counted_qty)}</td>
            <td class="num">${x.difference > 0 ? '+' : ''}${num(x.difference)} ${esc(x.unit)}</td><td class="num">${money(x.value)}</td></tr>`).join('')}</tbody></table></div>`,
      });
      load();
    } catch (e) { showError(e); }
  };

  /* ---------------- Lịch sử ---------------- */
  async function loadTx() {
    const p = new URLSearchParams({ limit: 300 });
    if ($('#tx-type').value) p.set('type', $('#tx-type').value);
    if ($('#tx-ing').value) p.set('ingredient_id', $('#tx-ing').value);
    try {
      const rows = await Api.get(`/api/inventory/transactions?${p}`);
      table($('#t-tx'), [
        { key: 'created_at', label: 'Thời gian', render: (r) => UI.dt(r.created_at) },
        { key: 'type', label: 'Loại', render: (r) => TX[r.type] || r.type },
        { key: 'ingredient', label: 'Nguyên liệu' },
        { key: 'quantity', label: 'Số lượng', render: (r) => `<b style="color:${r.quantity < 0 ? '#b42b2c' : '#006c10'}">${r.quantity > 0 ? '+' : ''}${num(r.quantity)}</b> ${esc(r.unit)}`, sortValue: (r) => r.quantity },
        { key: 'unit_cost', label: 'Đơn giá', type: 'num' },
        { key: 'note', label: 'Ghi chú' }, { key: 'employee', label: 'Nhân viên' },
      ], rows);
    } catch (e) { showError(e); }
  }
  async function loadCounts() {
    try {
      const rows = await Api.get('/api/inventory/counts');
      table($('#t-counts'), [
        { key: 'created_at', label: 'Thời gian', render: (r) => UI.dt(r.created_at) },
        { key: 'ingredient', label: 'Nguyên liệu' },
        { key: 'system_qty', label: 'Hệ thống', type: 'num' }, { key: 'counted_qty', label: 'Thực tế', type: 'num' },
        { key: 'difference', label: 'Chênh lệch', render: (r) => `${r.difference > 0 ? '+' : ''}${num(r.difference)} ${esc(r.unit)}`, sortValue: (r) => r.difference },
        { key: 'value', label: 'Giá trị', render: (r) => money(r.difference * r.unit_cost), sortValue: (r) => r.difference * r.unit_cost },
        { key: 'employee', label: 'Người kiểm' },
      ], rows);
    } catch (e) { showError(e); }
  }

  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
      if (b.dataset.tab === 'tx') loadTx();
      if (b.dataset.tab === 'counts') loadCounts();
    };
  });
  document.querySelectorAll('#level-chips .chip').forEach((c) => {
    c.onclick = () => { level = c.dataset.l; document.querySelectorAll('#level-chips .chip').forEach((x) => x.classList.toggle('active', x === c)); renderStock(); };
  });
  $('#q').oninput = renderStock;
  $('#btn-add').onclick = () => editDialog(null);
  $('#btn-import').onclick = () => importDialog();
  $('#tx-type').onchange = loadTx;
  $('#tx-ing').onchange = loadTx;
  load();
})();
