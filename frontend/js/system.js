(function () {
  const user = UI.init({ title: 'Bắt lỗi hệ thống', roles: ['admin', 'manager'] });
  if (!user) return;
  const { esc, table, toast, showError, confirmDialog } = UI;
  const $ = (s) => document.querySelector(s);

  const TYPES = {
    order: { label: '🧾 Không order được', badge: 'serious' },
    payment: { label: '💳 Thanh toán lỗi', badge: 'critical' },
    network: { label: '📡 Mất mạng', badge: 'warning' },
    system: { label: '🖥 Lỗi máy chủ', badge: 'critical' },
    client: { label: '🌐 Lỗi trình duyệt', badge: 'neutral' },
  };

  async function loadErrors() {
    const p = new URLSearchParams();
    if ($('#f-type').value) p.set('type', $('#f-type').value);
    if ($('#f-res').value !== '') p.set('resolved', $('#f-res').value);
    try {
      const { rows, stats } = await Api.get(`/api/errors?${p}`);
      $('#err-kpis').innerHTML = ['order', 'payment', 'network', 'system'].map((t) => {
        const s = stats.find((x) => x.type === t) || { total: 0, open: 0, last24h: 0 };
        return `<div class="kpi"><div class="label">${TYPES[t].label}</div><div class="value">${s.open || 0}</div>
          <span class="delta flat">chưa xử lý · ${s.last24h || 0} trong 24h · tổng ${s.total}</span></div>`;
      }).join('');
      table($('#t-errors'), [
        { key: 'created_at', label: 'Thời gian', render: (r) => UI.dt(r.created_at) },
        { key: 'type', label: 'Loại', render: (r) => `<span class="badge ${TYPES[r.type]?.badge || 'neutral'}">${TYPES[r.type]?.label || r.type}</span>` },
        { key: 'message', label: 'Nội dung', render: (r) => `<b>${esc(r.message)}</b>${r.detail ? `<div class="small muted" style="max-width:520px;overflow-wrap:anywhere">${esc(r.detail.slice(0, 300))}</div>` : ''}` },
        { key: 'employee', label: 'Nhân viên' },
        { key: 'resolved', label: 'Trạng thái', render: (r) => (r.resolved ? '<span class="badge good">✔ Đã xử lý</span>' : '<span class="badge warning">● Chưa xử lý</span>') },
        { key: 'id', label: '', sort: false, cls: 'actions', render: (r) => (r.resolved ? '' : `<button class="btn-sm" data-res="${r.id}">Đã xử lý</button>`) },
      ], rows, { empty: 'Không có lỗi nào 🎉' });
      document.querySelectorAll('[data-res]').forEach((b) => {
        b.onclick = async () => { try { await Api.post(`/api/errors/${b.dataset.res}/resolve`); loadErrors(); } catch (e) { showError(e); } };
      });
    } catch (e) { showError(e); }
  }

  function renderNet() {
    const off = Offline.list();
    $('#net-info').innerHTML = `
      <p>Trạng thái: ${Api.online ? '<span class="badge good">✔ Kết nối tốt</span>' : '<span class="badge critical">✖ Mất kết nối máy chủ</span>'}</p>
      <p>Service worker (chạy offline): ${navigator.serviceWorker?.controller ? '<span class="badge good">✔ Đang hoạt động</span>' : '<span class="badge warning">● Chưa kích hoạt — tải lại trang</span>'}</p>
      <p>Đơn offline trên máy này: <b>${off.length}</b></p>`;
    $('#offline-list').innerHTML = off.length ? `<div class="table-wrap"><table><thead><tr><th>Mã tạm</th><th>Thời gian</th><th>Lỗi đồng bộ</th><th></th></tr></thead><tbody>
      ${off.map((o) => `<tr><td>${esc(o.offline_code)}</td><td>${esc(o.created_at)}</td><td class="small">${esc(o.sync_error || 'Chờ mạng')}</td>
      <td class="actions"><button class="btn-sm btn-danger" data-drop="${o.client_uuid}">Bỏ</button></td></tr>`).join('')}</tbody></table></div>
      <button class="btn-primary" style="margin-top:8px" id="btn-sync">🔄 Đồng bộ ngay</button>` : '';
    const sync = $('#btn-sync');
    if (sync) sync.onclick = async () => {
      const r = await Offline.sync();
      toast(r ? `Đồng bộ ${r.synced} đơn${r.failed ? `, lỗi ${r.failed}` : ''}` : 'Chưa đồng bộ được (mất mạng?)', r && !r.failed ? 'success' : 'warn');
      renderNet(); loadErrors();
    };
    document.querySelectorAll('[data-drop]').forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmDialog('Bỏ đơn offline này? Dữ liệu đơn sẽ mất vĩnh viễn.', { danger: true, ok: 'Bỏ đơn' }))) return;
        Offline.remove(b.dataset.drop); renderNet();
      };
    });
  }

  async function loadSettings() {
    try {
      const s = await Api.get('/api/settings');
      $('#s-name').value = s.shop_name; $('#s-addr').value = s.shop_address; $('#s-fail').value = s.payment_fail_rate;
      $('#s-fail-v').textContent = `${Math.round(s.payment_fail_rate * 100)}%`;
    } catch (e) { showError(e); }
  }
  $('#s-fail').oninput = () => { $('#s-fail-v').textContent = `${Math.round($('#s-fail').value * 100)}%`; };
  $('#btn-save').onclick = async () => {
    try {
      await Api.put('/api/settings', { shop_name: $('#s-name').value, shop_address: $('#s-addr').value, payment_fail_rate: $('#s-fail').value });
      toast('Đã lưu cấu hình', 'success');
    } catch (e) { showError(e); }
  };
  $('#btn-ping').onclick = async () => { const ok = await Api.ping(); toast(ok ? '✔ Kết nối máy chủ ổn định' : '✖ Không kết nối được máy chủ', ok ? 'success' : 'error'); renderNet(); };
  $('#f-type').onchange = loadErrors;
  $('#f-res').onchange = loadErrors;
  $('#btn-resolve-all').onclick = async () => { try { await Api.post('/api/errors/resolve-all'); loadErrors(); } catch (e) { showError(e); } };
  Api.onStatus(renderNet);

  renderNet(); loadSettings(); loadErrors();
})();
