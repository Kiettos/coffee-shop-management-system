(function () {
  const user = UI.init({ title: 'Đơn hàng', roles: ['admin', 'manager', 'cashier', 'barista'] });
  if (!user) return;
  const { esc, money, num, table, toast, modal, showError, confirmDialog } = UI;
  const $ = (s) => document.querySelector(s);
  const isManager = ['admin', 'manager'].includes(user.role);

  const ST = {
    pending: '<span class="badge warning">⏳ Chờ thanh toán</span>',
    paid: '<span class="badge good">✔ Đã thanh toán</span>',
    cancelled: '<span class="badge neutral">✖ Đã hủy</span>',
  };
  const PM = { cash: '💵 Tiền mặt', qr: '📱 QR' };

  $('#from').value = UI.today();
  $('#to').value = UI.today();
  if (!isManager) { $('#from').disabled = true; $('#to').disabled = true; }

  let orders = [];
  async function load() {
    const p = new URLSearchParams({ limit: 500 });
    if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
    if ($('#status').value) p.set('status', $('#status').value);
    if ($('#from').value) p.set('from', $('#from').value);
    if ($('#to').value) p.set('to', $('#to').value);
    try {
      orders = await Api.get(`/api/orders?${p}`);
    } catch (e) { showError(e); return; }
    const paid = orders.filter((o) => o.status === 'paid');
    $('#o-kpis').innerHTML = `
      <div class="kpi"><div class="label">Số đơn</div><div class="value">${num(orders.length)}</div></div>
      <div class="kpi"><div class="label">Doanh thu (đã TT)</div><div class="value">${money(paid.reduce((s, o) => s + o.total, 0))}</div></div>
      <div class="kpi"><div class="label">Chờ thanh toán</div><div class="value">${orders.filter((o) => o.status === 'pending').length}</div></div>
      <div class="kpi"><div class="label">Đơn hủy</div><div class="value">${orders.filter((o) => o.status === 'cancelled').length}</div></div>`;
    table($('#t-orders'), [
      { key: 'code', label: 'Mã đơn', render: (o) => `<b>${esc(o.code)}</b>${o.offline ? ' <span class="badge info" title="Tạo khi mất mạng">📡 offline</span>' : ''}` },
      { key: 'created_at', label: 'Thời gian', render: (o) => UI.dt(o.created_at) },
      { key: 'table_no', label: 'Bàn' },
      { key: 'summary', label: 'Món', render: (o) => `<span class="small">${esc(o.summary || '')}</span>`, sort: false },
      { key: 'total', label: 'Tổng', type: 'money' },
      { key: 'payment_method', label: 'Thanh toán', render: (o) => PM[o.payment_method] || '—' },
      { key: 'status', label: 'Trạng thái', render: (o) => ST[o.status] },
      { key: 'employee_name', label: 'Thu ngân' },
      { key: 'id', label: '', sort: false, cls: 'actions', render: (o) => `<button class="btn-sm" data-view="${o.id}">Chi tiết</button>` },
    ], orders, { empty: 'Không có đơn hàng nào' });
    document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => view(Number(b.dataset.view)); });
  }

  async function view(id) {
    let o;
    try { o = await Api.get(`/api/orders/${id}`); } catch (e) { return showError(e); }
    const canCancel = o.status === 'pending' || (o.status === 'paid' && isManager);
    const m = modal({
      title: `Đơn ${o.code}`, wide: true,
      body: `<div class="row" style="margin-bottom:10px">
          <div>${ST[o.status]}</div><div class="muted">${UI.dt(o.created_at)}</div>
          <div>Thu ngân: <b>${esc(o.employee_name)}</b></div>${o.table_no ? `<div>Bàn: <b>${esc(o.table_no)}</b></div>` : ''}
        </div>
        ${o.cancel_reason ? `<p class="badge neutral">Lý do hủy: ${esc(o.cancel_reason)}</p>` : ''}
        <div class="table-wrap"><table><thead><tr><th>Món</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th><th class="num">Giá vốn</th><th>Trạng thái</th><th></th></tr></thead><tbody>
        ${o.items.map((i) => `<tr><td>${esc(i.product_name)}${i.note ? `<div class="small muted">${esc(i.note)}</div>` : ''}</td>
          <td class="num">${i.quantity}</td><td class="num">${money(i.unit_price)}</td><td class="num">${money(i.unit_price * i.quantity)}</td>
          <td class="num muted">${money(i.unit_cost * i.quantity)}</td>
          <td>${i.status === 'ok' ? '<span class="badge good">✔</span>' : `<span class="badge neutral">✖ ${esc(i.cancel_reason || 'Hủy')}</span>`}</td>
          <td class="actions">${o.status === 'pending' && i.status === 'ok' ? `<button class="btn-sm btn-danger" data-item="${i.id}">Hủy món</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="cart-total" style="max-width:320px;margin-left:auto">
          <div class="line"><span>Tạm tính</span><span class="num">${money(o.subtotal)}</span></div>
          <div class="line"><span>Giảm giá</span><span class="num">${money(o.discount)}</span></div>
          <div class="line"><b>Tổng</b><b class="num">${money(o.total)}</b></div>
          ${isManager ? `<div class="line muted"><span>Giá vốn / Lợi nhuận</span><span class="num">${money(o.cost_total)} / ${money(o.total - o.cost_total)}</span></div>` : ''}
        </div>
        ${o.payments.length ? `<h3 style="margin-top:12px">Lịch sử thanh toán</h3><ul class="small">${o.payments.map((p) =>
          `<li>${UI.dt(p.created_at)} · ${PM[p.method]} · ${money(p.amount)} · ${p.status === 'success' ? '<span class="badge good">✔ Thành công</span>' : `<span class="badge critical">✖ Thất bại</span> ${esc(p.message || '')}`}</li>`).join('')}</ul>` : ''}`,
      foot: `${canCancel ? '<button class="btn-danger" data-a="cancel">Hủy đơn</button>' : ''}
        ${o.status === 'pending' ? '<a class="btn btn-primary" href="/order.html">Thanh toán tại màn hình bán hàng</a>' : ''}
        <button data-a="close">Đóng</button>`,
    });
    m.$('[data-a=close]').onclick = m.close;
    m.$$('[data-item]').forEach((b) => {
      b.onclick = () => cancelDialog('Hủy món', async (reason, restock) => {
        await Api.post(`/api/orders/${o.id}/items/${b.dataset.item}/cancel`, { reason, restock });
        toast('Đã hủy món', 'success'); m.close(); view(o.id); load();
      });
    });
    const c = m.$('[data-a=cancel]');
    if (c) c.onclick = () => cancelDialog(`Hủy đơn ${o.code}`, async (reason, restock) => {
      if (o.status === 'paid' && !(await confirmDialog('Đơn này đã thanh toán. Hủy đơn đồng nghĩa với hoàn tiền cho khách. Tiếp tục?', { danger: true, ok: 'Hủy & hoàn tiền' }))) return;
      await Api.post(`/api/orders/${o.id}/cancel`, { reason, restock });
      toast('Đã hủy đơn', 'success'); m.close(); load();
    });
  }

  function cancelDialog(title, action) {
    const m = modal({
      title,
      body: `<div class="field"><label for="reason">Lý do</label>
        <select id="reason"><option>Khách đổi ý</option><option>Khách đợi lâu</option><option>Pha sai món</option><option>Nhập nhầm đơn</option><option>Hết nguyên liệu</option><option value="">Khác...</option></select></div>
        <div class="field hidden" id="other-wrap"><input id="other" placeholder="Nhập lý do"></div>
        <label style="font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" id="restock" checked style="width:auto;min-height:auto">
          Hoàn nguyên liệu về kho (bỏ chọn nếu món đã pha xong — sẽ tính vào hao hụt)</label>`,
      foot: '<button data-a="no">Đóng</button><button class="btn-danger" data-a="ok">Xác nhận hủy</button>',
    });
    m.$('#reason').onchange = () => {
      m.$('#other-wrap').classList.toggle('hidden', m.$('#reason').value !== '');
      if (m.$('#reason').value === 'Pha sai món') m.$('#restock').checked = false;
    };
    m.$('[data-a=no]').onclick = m.close;
    m.$('[data-a=ok]').onclick = async () => {
      const reason = m.$('#reason').value || m.$('#other').value.trim();
      if (!reason) return toast('Vui lòng nhập lý do', 'warn');
      try { await action(reason, m.$('#restock').checked); m.close(); } catch (e) { showError(e); }
    };
  }

  let t;
  $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  ['#status', '#from', '#to'].forEach((s) => { $(s).onchange = load; });
  $('#btn-reload').onclick = load;
  load();
})();
