/* =====================================================================
   Màn hình bán hàng (POS)
   - Chọn món theo danh mục / tìm kiếm, ghi chú món, giảm giá
   - Thanh toán tiền mặt (tính tiền thối) hoặc QR (xử lý lỗi cổng thanh toán)
   - Báo hết nguyên liệu, cho bỏ món khỏi giỏ
   - Mất mạng: vẫn bán tiền mặt, đơn lưu trên máy và tự đồng bộ
   ===================================================================== */
(function () {
  const user = UI.init({ title: 'Bán hàng', roles: ['admin', 'manager', 'cashier'] });
  if (!user) return;
  const { esc, money, toast, modal, showError } = UI;
  const $ = (s) => document.querySelector(s);
  const MENU_KEY = 'csm_menu_cache';

  let products = [];
  let categories = [];
  let currentCat = 0;
  let cart = [];
  let shop = { shop_name: 'Coffee House', shop_address: '' };

  /* ---------------- Tải thực đơn (có dự phòng offline) ---------------- */
  async function loadMenu() {
    try {
      const [p, c, s] = await Promise.all([Api.get('/api/products?active=1'), Api.get('/api/categories'), Api.get('/api/settings')]);
      products = p; categories = c; shop = s;
      localStorage.setItem(MENU_KEY, JSON.stringify({ products, categories, shop, at: Date.now() }));
    } catch (e) {
      const cached = JSON.parse(localStorage.getItem(MENU_KEY) || 'null');
      if (!cached) { showError(e, 'Không tải được thực đơn'); return; }
      ({ products, categories, shop } = cached);
      toast('📡 Đang dùng thực đơn đã lưu trên máy (offline)', 'warn');
    }
    renderCats();
    renderProducts();
  }

  function renderCats() {
    $('#cat-chips').innerHTML = [{ id: 0, name: 'Tất cả' }, ...categories].map((c) =>
      `<button class="chip ${c.id === currentCat ? 'active' : ''}" data-id="${c.id}">${esc(c.name)}</button>`).join('');
    $('#cat-chips').querySelectorAll('.chip').forEach((b) => { b.onclick = () => { currentCat = Number(b.dataset.id); renderCats(); renderProducts(); }; });
  }

  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

  function renderProducts() {
    const q = norm($('#search').value.trim());
    const list = products.filter((p) => (!currentCat || p.category_id === currentCat) && (!q || norm(p.name).includes(q)));
    $('#products').innerHTML = list.length ? list.map((p) => {
      const out = p.can_make === 0;
      const low = p.can_make !== null && p.can_make > 0 && p.can_make <= 5;
      return `<button class="product ${out ? 'out' : ''}" data-id="${p.id}" title="${out ? 'Hết nguyên liệu' : ''}">
        <span class="name">${esc(p.name)}</span>
        <span class="stock muted">${esc(p.category)}</span>
        ${out ? '<span class="badge critical">✖ Hết nguyên liệu</span>' : low ? `<span class="badge warning">⚠ Còn ${p.can_make} ly</span>` : ''}
        <span class="price">${money(p.price)}</span></button>`;
    }).join('') : '<div class="muted">Không tìm thấy món phù hợp</div>';
    $('#products').querySelectorAll('.product').forEach((b) => { b.onclick = () => addToCart(Number(b.dataset.id)); });
  }

  /* ---------------- Giỏ hàng ---------------- */
  function addToCart(pid) {
    const p = products.find((x) => x.id === pid);
    if (!p) return;
    if (p.can_make === 0) toast(`⚠ "${p.name}" có thể đã hết nguyên liệu — hệ thống sẽ kiểm tra khi tạo đơn`, 'warn');
    const line = cart.find((l) => l.product_id === pid && !l.note);
    if (line) line.quantity++;
    else cart.push({ product_id: pid, name: p.name, price: p.price, quantity: 1, note: '' });
    renderCart();
  }

  const subtotal = () => cart.reduce((s, l) => s + l.price * l.quantity, 0);
  const discount = () => Math.min(Math.max(Number($('#discount').value) || 0, 0), subtotal());
  const total = () => subtotal() - discount();

  function renderCart() {
    const box = $('#cart-items');
    box.innerHTML = cart.length ? cart.map((l, i) => `
      <div class="cart-line">
        <div><div class="name">${esc(l.name)}</div><div class="muted small">${money(l.price)} × ${l.quantity} = <b>${money(l.price * l.quantity)}</b></div></div>
        <div class="qty"><button data-i="${i}" data-d="-1" aria-label="Giảm">−</button><b>${l.quantity}</b><button data-i="${i}" data-d="1" aria-label="Tăng">+</button></div>
        <div class="note"><input data-note="${i}" placeholder="Ghi chú: ít đá, ít ngọt..." value="${esc(l.note)}"></div>
      </div>`).join('') : '<div class="empty">Chưa có món nào.<br>Chọn món ở thực đơn bên trái.</div>';
    box.querySelectorAll('button[data-i]').forEach((b) => {
      b.onclick = () => {
        const l = cart[Number(b.dataset.i)];
        l.quantity += Number(b.dataset.d);
        if (l.quantity <= 0) cart.splice(Number(b.dataset.i), 1);
        renderCart();
      };
    });
    box.querySelectorAll('input[data-note]').forEach((inp) => { inp.oninput = () => { cart[Number(inp.dataset.note)].note = inp.value; }; });
    $('#subtotal').textContent = money(subtotal());
    $('#disc-view').textContent = discount() ? `−${money(discount())}` : '0đ';
    $('#grand').textContent = money(total());
    $('#cart-count').textContent = cart.reduce((s, l) => s + l.quantity, 0);
    $('#cart-total-mini').textContent = money(total());
    $('#pay-qr').title = Api.online ? '' : 'Thanh toán QR cần có mạng';
  }

  function clearCart() {
    cart = [];
    $('#table-no').value = '';
    $('#discount').value = 0;
    renderCart();
    $('#cart').classList.remove('expanded');
  }

  const payload = () => ({
    items: cart.map((l) => ({ product_id: l.product_id, quantity: l.quantity, note: l.note || undefined })),
    table_no: $('#table-no').value.trim() || undefined,
    discount: discount(),
    client_uuid: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  });

  /* ---------------- Xử lý lỗi tạo đơn ---------------- */
  function handleOrderError(e) {
    if (e.data?.code === 'OUT_OF_STOCK') {
      const shortages = e.data.shortages || [];
      const bad = new Set(shortages.flatMap((s) => s.products.map((p) => p.id)));
      const m = modal({
        title: '⚠ Không đủ nguyên liệu',
        body: `<p>Không tạo được đơn vì kho không đủ nguyên liệu:</p>
          <div class="table-wrap"><table><thead><tr><th>Nguyên liệu</th><th class="num">Cần</th><th class="num">Còn</th><th>Món bị ảnh hưởng</th></tr></thead><tbody>
          ${shortages.map((s) => `<tr><td>${esc(s.ingredient)}</td><td class="num">${UI.num(s.need)} ${esc(s.unit)}</td><td class="num">${UI.num(s.stock)} ${esc(s.unit)}</td>
          <td>${s.products.map((p) => esc(p.name)).join(', ')}</td></tr>`).join('')}</tbody></table></div>
          <p class="muted small">Sự cố đã được ghi nhận vào báo cáo "món hết nguyên liệu". Hãy báo quản lý nhập thêm hàng.</p>`,
        foot: '<button data-a="close">Đóng</button><button class="btn-primary" data-a="remove">Bỏ các món hết khỏi giỏ</button>',
      });
      m.$('[data-a=close]').onclick = m.close;
      m.$('[data-a=remove]').onclick = () => { cart = cart.filter((l) => !bad.has(l.product_id)); renderCart(); m.close(); loadMenu(); };
      return;
    }
    showError(e, 'Không tạo được đơn hàng');
  }

  /* ---------------- Thanh toán tiền mặt ---------------- */
  function cashDialog(amount, onConfirm) {
    const quick = [...new Set([amount, Math.ceil(amount / 10000) * 10000, Math.ceil(amount / 50000) * 50000, Math.ceil(amount / 100000) * 100000, 200000, 500000])]
      .filter((v) => v >= amount).slice(0, 5);
    const m = modal({
      title: '💵 Thanh toán tiền mặt',
      body: `<div class="line" style="font-size:16px">Cần thanh toán: <b class="grand">${money(amount)}</b></div>
        <div class="field" style="margin-top:12px"><label for="received">Tiền khách đưa</label>
        <input id="received" type="number" inputmode="numeric" min="0" step="1000" value="${amount}"></div>
        <div class="cash-quick">${quick.map((v) => `<button class="btn-sm" data-v="${v}">${money(v)}</button>`).join('')}</div>
        <p style="margin-top:14px">Tiền thối lại: <span class="change" id="change">0đ</span></p>
        ${Api.online ? '' : '<p class="badge warning">📡 Đang offline — đơn sẽ được lưu trên máy và đồng bộ sau</p>'}`,
      foot: '<button data-a="cancel">Hủy</button><button class="btn-success btn-lg" data-a="ok">Xác nhận đã thu tiền</button>',
    });
    const upd = () => {
      const r = Number(m.$('#received').value) || 0;
      const ch = r - amount;
      m.$('#change').textContent = ch >= 0 ? money(ch) : `Thiếu ${money(-ch)}`;
      m.$('#change').style.color = ch >= 0 ? '' : '#b42b2c';
      m.$('[data-a=ok]').disabled = ch < 0;
    };
    m.$('#received').oninput = upd;
    m.$$('[data-v]').forEach((b) => { b.onclick = () => { m.$('#received').value = b.dataset.v; upd(); }; });
    m.$('[data-a=cancel]').onclick = m.close;
    m.$('[data-a=ok]').onclick = async () => {
      m.$('[data-a=ok]').disabled = true;
      const received = Number(m.$('#received').value) || 0;
      const ok = await onConfirm(received);
      if (ok !== false) m.close(); else m.$('[data-a=ok]').disabled = false;
    };
    upd();
  }

  async function checkoutCash() {
    if (!cart.length) return toast('Giỏ hàng đang trống', 'warn');
    const body = payload();
    const amount = total();
    cashDialog(amount, async (received) => {
      try {
        const order = await Api.post('/api/orders', { ...body, payment_method: 'cash' });
        receipt(order, { received, change: received - order.total });
        clearCart();
        loadMenu();
      } catch (e) {
        if (e.network) {
          // MẤT MẠNG: lưu đơn trên máy, tự đồng bộ khi có mạng
          const o = Offline.add({ ...body, payment_method: 'cash' });
          receipt({
            code: o.offline_code, created_at: o.created_at, table_no: body.table_no, employee_name: user.full_name,
            items: cart.map((l) => ({ product_name: l.name, quantity: l.quantity, unit_price: l.price, status: 'ok', note: l.note })),
            subtotal: subtotal(), discount: body.discount, total: amount, payment_method: 'cash', offline: true,
          }, { received, change: received - amount });
          toast('📡 Mất mạng — đơn đã được lưu trên máy, sẽ tự đồng bộ khi có mạng', 'warn', 6000);
          clearCart();
          return true;
        }
        handleOrderError(e);
        return true;
      }
      return true;
    });
  }

  /* ---------------- Thanh toán QR ---------------- */
  async function checkoutQr(existingOrder) {
    if (!existingOrder && !cart.length) return toast('Giỏ hàng đang trống', 'warn');
    if (!Api.online) return toast('📡 Đang mất mạng — không thể thanh toán QR. Vui lòng thu tiền mặt.', 'error', 5000);
    let order = existingOrder;
    if (!order) {
      try {
        order = await Api.post('/api/orders', payload());
        clearCart();
      } catch (e) {
        if (e.network) return toast('📡 Mất mạng — không tạo được đơn QR. Hãy dùng thanh toán tiền mặt (đơn sẽ lưu offline).', 'error', 6000);
        return handleOrderError(e);
      }
    }
    let qr;
    try { qr = await Api.get(`/api/orders/${order.id}/qr`); } catch (e) { showError(e); }

    const m = modal({
      title: `📱 Thanh toán QR · ${order.code}`,
      body: `<div class="qr-box">
          ${qr ? `<img src="${qr.qr}" alt="Mã QR chuyển khoản">
          <p><b>${esc(qr.bank)}</b> · STK <b>${esc(qr.account)}</b><br>${esc(qr.owner)}<br>Nội dung: <b>${esc(qr.memo)}</b></p>` : ''}
          <p style="font-size:18px">Số tiền: <b>${money(order.total)}</b></p>
        </div>
        <div id="qr-error" class="hidden" role="alert" style="background:#fdecec;color:#9b1f20;padding:10px;border-radius:8px;font-weight:600"></div>
        <label style="margin-top:10px;font-weight:400" class="small muted"><input type="checkbox" id="sim-fail" style="width:auto;min-height:auto"> Giả lập cổng thanh toán bị lỗi (demo)</label>`,
      foot: `<button data-a="later">Thanh toán sau</button><button class="btn-success hidden" data-a="cash">💵 Chuyển sang tiền mặt</button>
        <button class="btn-primary" data-a="ok">✅ Xác nhận đã nhận chuyển khoản</button>`,
    });
    m.$('[data-a=later]').onclick = () => { m.close(); toast(`Đơn ${order.code} đang chờ thanh toán`); refreshPending(); };
    m.$('[data-a=cash]').onclick = () => {
      m.close();
      cashDialog(order.total, async (received) => {
        try {
          const paid = await Api.post(`/api/orders/${order.id}/pay`, { method: 'cash', received });
          receipt(paid, { received, change: paid.change });
          refreshPending();
        } catch (e) { showError(e); return false; }
        return true;
      });
    };
    m.$('[data-a=ok]').onclick = async () => {
      const btn = m.$('[data-a=ok]');
      btn.disabled = true; btn.textContent = 'Đang xác nhận...';
      try {
        const paid = await Api.post(`/api/orders/${order.id}/pay`, { method: 'qr', simulate_failure: m.$('#sim-fail').checked });
        m.close();
        receipt(paid);
        refreshPending();
      } catch (e) {
        // THANH TOÁN LỖI: cho thử lại hoặc chuyển tiền mặt, đơn vẫn được giữ ở trạng thái chờ
        const box = m.$('#qr-error');
        box.textContent = e.network ? '📡 Mất kết nối khi xác nhận thanh toán. Đơn vẫn được giữ, hãy thử lại khi có mạng hoặc thu tiền mặt.' : `❌ ${e.message}`;
        box.classList.remove('hidden');
        m.$('[data-a=cash]').classList.remove('hidden');
        btn.disabled = false; btn.textContent = '🔁 Thử lại';
      }
    };
  }

  async function holdOrder() {
    if (!cart.length) return toast('Giỏ hàng đang trống', 'warn');
    try {
      const o = await Api.post('/api/orders', payload());
      toast(`Đã lưu đơn ${o.code} — chờ thanh toán`, 'success');
      clearCart();
      refreshPending();
      loadMenu();
    } catch (e) {
      if (e.network) return toast('📡 Mất mạng — không thể lưu đơn chờ. Hãy thu tiền mặt ngay để lưu đơn offline.', 'error', 6000);
      handleOrderError(e);
    }
  }

  /* ---------------- Đơn chờ thanh toán ---------------- */
  async function refreshPending() {
    try {
      const list = await Api.get('/api/orders?status=pending&limit=50');
      $('#pending-count').textContent = list.length + Offline.count();
      return list;
    } catch { $('#pending-count').textContent = Offline.count(); return []; }
  }

  async function pendingDialog() {
    const list = await refreshPending();
    const off = Offline.list();
    const m = modal({
      title: '⏳ Đơn chờ thanh toán', wide: true,
      body: `${list.length ? `<div class="table-wrap"><table><thead><tr><th>Mã đơn</th><th>Bàn</th><th>Món</th><th class="num">Tổng</th><th>Giờ</th><th></th></tr></thead><tbody>
        ${list.map((o) => `<tr><td><b>${esc(o.code)}</b></td><td>${esc(o.table_no || '')}</td><td class="small">${esc(o.summary || '')}</td>
          <td class="num">${money(o.total)}</td><td class="small">${UI.dt(o.created_at)}</td>
          <td class="actions"><button class="btn-sm btn-success" data-cash="${o.id}">Tiền mặt</button> <button class="btn-sm btn-primary" data-qr="${o.id}">QR</button>
          <button class="btn-sm btn-danger" data-cancel="${o.id}">Hủy</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Không có đơn nào đang chờ thanh toán.</p>'}
        ${off.length ? `<h3 style="margin-top:16px">📡 Đơn offline chờ đồng bộ (${off.length})</h3>
          <div class="table-wrap"><table><thead><tr><th>Mã tạm</th><th>Thời gian</th><th class="num">Số món</th><th>Lỗi</th></tr></thead><tbody>
          ${off.map((o) => `<tr><td>${esc(o.offline_code)}</td><td>${esc(o.created_at)}</td><td class="num">${o.items.reduce((s, i) => s + i.quantity, 0)}</td>
          <td class="small">${esc(o.sync_error || 'Đang chờ mạng')}</td></tr>`).join('')}</tbody></table></div>
          <button class="btn-primary" style="margin-top:8px" data-sync>🔄 Đồng bộ ngay</button>` : ''}`,
    });
    m.$$('[data-cash]').forEach((b) => {
      b.onclick = () => {
        const o = list.find((x) => x.id === Number(b.dataset.cash));
        m.close();
        cashDialog(o.total, async (received) => {
          try { const paid = await Api.post(`/api/orders/${o.id}/pay`, { method: 'cash', received }); receipt(paid, { received, change: paid.change }); refreshPending(); } catch (e) { showError(e); return false; }
          return true;
        });
      };
    });
    m.$$('[data-qr]').forEach((b) => { b.onclick = () => { const o = list.find((x) => x.id === Number(b.dataset.qr)); m.close(); checkoutQr(o); }; });
    m.$$('[data-cancel]').forEach((b) => {
      b.onclick = async () => {
        const reason = prompt('Lý do hủy đơn?', 'Khách đổi ý');
        if (!reason) return;
        try { await Api.post(`/api/orders/${b.dataset.cancel}/cancel`, { reason, restock: true }); toast('Đã hủy đơn, nguyên liệu đã hoàn kho', 'success'); m.close(); pendingDialog(); loadMenu(); } catch (e) { showError(e); }
      };
    });
    const sync = m.$('[data-sync]');
    if (sync) sync.onclick = async () => {
      if (!(await Api.ping())) return toast('📡 Vẫn chưa có mạng', 'error');
      const r = await Offline.sync();
      toast(r ? `Đã đồng bộ ${r.synced} đơn${r.failed ? `, lỗi ${r.failed}` : ''}` : 'Không đồng bộ được', r?.failed ? 'warn' : 'success');
      m.close(); pendingDialog();
    };
  }

  /* ---------------- Hóa đơn ---------------- */
  function receipt(order, { received, change } = {}) {
    const items = (order.items || []).filter((i) => i.status !== 'cancelled');
    const m = modal({
      title: order.offline ? '🧾 Hóa đơn (offline)' : '🧾 Thanh toán thành công',
      body: `<div class="receipt print-area">
        <div class="c"><b style="font-size:15px">${esc(shop.shop_name)}</b><br>${esc(shop.shop_address || '')}</div><hr>
        <div>Mã HĐ: <b>${esc(order.code)}</b>${order.offline ? ' (chờ đồng bộ)' : ''}<br>Thời gian: ${UI.dt(order.paid_at || order.created_at)}
        ${order.table_no ? `<br>Bàn: ${esc(order.table_no)}` : ''}<br>Thu ngân: ${esc(order.employee_name || user.full_name)}</div><hr>
        <table>${items.map((i) => `<tr><td>${esc(i.product_name)}${i.note ? `<br><i class="small">(${esc(i.note)})</i>` : ''}<br>${i.quantity} × ${money(i.unit_price)}</td>
          <td class="num" style="vertical-align:bottom">${money(i.quantity * i.unit_price)}</td></tr>`).join('')}</table><hr>
        <table><tr><td>Tạm tính</td><td class="num">${money(order.subtotal)}</td></tr>
        ${order.discount ? `<tr><td>Giảm giá</td><td class="num">−${money(order.discount)}</td></tr>` : ''}
        <tr><td><b>TỔNG CỘNG</b></td><td class="num"><b>${money(order.total)}</b></td></tr>
        <tr><td>Thanh toán</td><td class="num">${order.payment_method === 'qr' ? 'Chuyển khoản QR' : 'Tiền mặt'}</td></tr>
        ${received ? `<tr><td>Khách đưa</td><td class="num">${money(received)}</td></tr><tr><td>Tiền thối</td><td class="num">${money(change)}</td></tr>` : ''}
        </table><hr><div class="c">Cảm ơn quý khách! Hẹn gặp lại ☕</div></div>`,
      foot: '<button data-a="print">🖨 In hóa đơn</button><button class="btn-primary" data-a="new">Đơn mới</button>',
    });
    m.$('[data-a=print]').onclick = () => window.print();
    m.$('[data-a=new]').onclick = m.close;
  }

  /* ---------------- Sự kiện ---------------- */
  $('#search').oninput = renderProducts;
  $('#discount').oninput = renderCart;
  $('#btn-clear').onclick = () => { if (cart.length) clearCart(); };
  $('#pay-cash').onclick = checkoutCash;
  $('#pay-qr').onclick = () => checkoutQr();
  $('#btn-hold').onclick = holdOrder;
  $('#btn-pending').onclick = pendingDialog;
  $('#cart-toggle').onclick = () => $('#cart').classList.toggle('expanded');
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('#search').focus(); }
  });
  Api.onStatus(() => { renderCart(); refreshPending(); });

  loadMenu();
  renderCart();
  refreshPending();
})();
