/* =====================================================================
   Bố cục chung (menu, thanh trên, trạng thái mạng) + tiện ích giao diện
   ===================================================================== */
(function () {
  const NAV = [
    { href: '/order.html', icon: '🧾', label: 'Bán hàng', roles: ['admin', 'manager', 'cashier'] },
    { href: '/orders.html', icon: '📋', label: 'Đơn hàng', roles: ['admin', 'manager', 'cashier', 'barista'] },
    { href: '/dashboard.html', icon: '📊', label: 'Báo cáo', roles: ['admin', 'manager'] },
    { href: '/forecast.html', icon: '🔮', label: 'Dự báo & AI', roles: ['admin', 'manager'] },
    { href: '/inventory.html', icon: '📦', label: 'Kho nguyên liệu', roles: ['admin', 'manager', 'cashier', 'barista'] },
    { href: '/products.html', icon: '☕', label: 'Sản phẩm & công thức', roles: ['admin', 'manager'] },
    { href: '/employees.html', icon: '👥', label: 'Nhân viên', roles: ['admin', 'manager'] },
    { href: '/system.html', icon: '🛠️', label: 'Bắt lỗi hệ thống', roles: ['admin', 'manager'] },
  ];
  const ROLE_LABEL = { admin: 'Quản trị', manager: 'Quản lý', cashier: 'Thu ngân', barista: 'Pha chế' };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;
  const moneyShort = (n) => {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}k`;
    return v.toLocaleString('vi-VN');
  };
  const num = (n, d = 2) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }));
  const pct = (n) => (n === null || n === undefined ? '—' : `${num(n, 1)}%`);
  const dt = (s) => (s ? new Date(s.replace(' ', 'T')).toLocaleString('vi-VN', { hour12: false }) : '');
  const today = () => new Date().toLocaleDateString('sv-SE');
  const dateAdd = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };

  function delta(v, { inverse = false } = {}) {
    if (v === null || v === undefined) return '<span class="delta flat">— không có dữ liệu kỳ trước</span>';
    if (Math.abs(v) < 0.05) return '<span class="delta flat">● 0% so với kỳ trước</span>';
    const good = inverse ? v < 0 : v > 0;
    return `<span class="delta ${good ? 'up' : 'down'}">${v > 0 ? '▲' : '▼'} ${num(Math.abs(v), 1)}% so với kỳ trước</span>`;
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, type = 'info', ms = 3500) {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  /* ---------------- Modal ---------------- */
  function modal({ title, body = '', foot = '', wide = false, onClose } = {}) {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="x" aria-label="Đóng">×</button></div>
      <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
    const close = () => { bd.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    bd.querySelector('.x').onclick = close;
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bd);
    const first = bd.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return { el: bd, close, $: (s) => bd.querySelector(s), $$: (s) => bd.querySelectorAll(s) };
  }

  function confirmDialog(message, { title = 'Xác nhận', ok = 'Đồng ý', danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const m = modal({
        title, body: `<p>${esc(message)}</p>`,
        foot: `<button data-a="no">Hủy</button><button data-a="ok" class="${danger ? 'btn-danger' : 'btn-primary'}">${esc(ok)}</button>`,
        onClose: () => { if (!done) resolve(false); },
      });
      m.$('[data-a=no]').onclick = () => m.close();
      m.$('[data-a=ok]').onclick = () => { done = true; m.close(); resolve(true); };
    });
  }

  /** Hiển thị lỗi API thân thiện */
  function showError(e, fallback = 'Có lỗi xảy ra') {
    if (e?.network) toast(`📡 ${e.message}`, 'error', 5000);
    else toast(e?.message || fallback, 'error', 5000);
  }

  /* ---------------- Bảng có sắp xếp ----------------
     columns: [{ key, label, type: 'money'|'num'|'pct'|'text'|'html', render(row), sort: false, bar: true }] */
  function table(el, columns, rows, { empty = 'Không có dữ liệu', maxBar } = {}) {
    let sortKey = null; let dir = -1;
    const draw = () => {
      let data = rows;
      if (sortKey) {
        const c = columns.find((x) => x.key === sortKey);
        data = [...rows].sort((a, b) => {
          const va = c.sortValue ? c.sortValue(a) : a[sortKey]; const vb = c.sortValue ? c.sortValue(b) : b[sortKey];
          if (typeof va === 'number' || typeof vb === 'number') return ((Number(va) || 0) - (Number(vb) || 0)) * dir;
          return String(va ?? '').localeCompare(String(vb ?? ''), 'vi') * dir;
        });
      }
      const maxes = {};
      columns.filter((c) => c.bar).forEach((c) => { maxes[c.key] = maxBar || Math.max(...rows.map((r) => Math.abs(Number(r[c.key]) || 0)), 1); });
      const fmt = (c, r) => {
        if (c.render) return c.render(r);
        const v = r[c.key];
        let s = c.type === 'money' ? money(v) : c.type === 'num' ? num(v) : c.type === 'pct' ? pct(v) : esc(v);
        if (c.bar) {
          const w = Math.round((Math.abs(Number(v) || 0) / maxes[c.key]) * 100);
          s = `<div class="bar-cell"><div class="bar ${Number(v) < 0 ? 'neg' : ''}" style="width:${w}%"></div><span>${s}</span></div>`;
        }
        return s;
      };
      const isNum = (c) => ['money', 'num', 'pct'].includes(c.type) && !c.bar;
      el.innerHTML = `<div class="table-wrap"><table><thead><tr>${columns.map((c) =>
        `<th class="${c.sort === false ? '' : 'sortable'} ${isNum(c) ? 'num' : ''}" data-k="${c.key}">${esc(c.label)}${sortKey === c.key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}
        </tr></thead><tbody>${data.length ? data.map((r) => `<tr>${columns.map((c) =>
          `<td class="${isNum(c) ? 'num' : ''} ${c.cls || ''}">${fmt(c, r)}</td>`).join('')}</tr>`).join('')
        : `<tr><td class="empty" colspan="${columns.length}">${esc(empty)}</td></tr>`}</tbody></table></div>`;
      el.querySelectorAll('th.sortable').forEach((th) => {
        th.onclick = () => { const k = th.dataset.k; if (sortKey === k) dir = -dir; else { sortKey = k; dir = -1; } draw(); };
      });
    };
    draw();
  }

  /* ---------------- Khung trang ---------------- */
  function netPillHtml() {
    const q = window.Offline ? Offline.count() : 0;
    if (!Api.online) return `<span class="net-pill offline" title="Không kết nối được máy chủ"><span class="dot"></span>Mất mạng${q ? ` · ${q} đơn chờ` : ''}</span>`;
    if (q) return `<span class="net-pill syncing" title="Đang chờ đồng bộ"><span class="dot"></span>${q} đơn chờ đồng bộ</span>`;
    return '<span class="net-pill" title="Kết nối ổn định"><span class="dot"></span>Trực tuyến</span>';
  }

  function init({ title, roles } = {}) {
    const user = Api.user;
    if (!Api.token || !user) {
      location.href = `/index.html?next=${encodeURIComponent(location.pathname)}`;
      return null;
    }
    if (roles && !roles.includes(user.role)) {
      const first = NAV.find((n) => n.roles.includes(user.role));
      location.href = first ? first.href : '/index.html';
      return null;
    }
    const page = document.getElementById('page');
    const app = document.createElement('div');
    app.className = 'app';
    app.innerHTML = `
      <aside class="sidebar" id="sidebar">
        <div class="logo"><span class="cup">☕</span><span>Coffee Manager</span></div>
        <nav>${NAV.filter((n) => n.roles.includes(user.role)).map((n) =>
          `<a href="${n.href}" class="${location.pathname === n.href ? 'active' : ''}"><span class="ico">${n.icon}</span>${n.label}</a>`).join('')}</nav>
        <div class="me"><div><b>${esc(user.full_name)}</b></div><div class="small" style="opacity:.75">${ROLE_LABEL[user.role] || user.role}</div>
          <button class="btn-sm" id="btn-logout">Đăng xuất</button></div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="menu-btn btn-sm" id="menu-btn" aria-label="Mở menu">☰</button>
          <h1>${esc(title || document.title)}</h1>
          <span id="net-pill">${netPillHtml()}</span>
        </header>
        <div class="offline-banner hidden" id="offline-banner">📡 Mất kết nối tới máy chủ. Bạn vẫn có thể bán hàng (tiền mặt) — đơn sẽ được lưu trên máy và tự đồng bộ khi có mạng.</div>
        <main class="content" id="content"></main>
      </div>`;
    document.body.prepend(app);
    app.querySelector('#content').appendChild(page);
    page.classList.remove('hidden');

    app.querySelector('#btn-logout').onclick = async () => {
      if (Offline.count() && !(await confirmDialog(`Còn ${Offline.count()} đơn offline chưa đồng bộ. Đăng xuất vẫn giữ lại đơn trên máy này. Tiếp tục?`))) return;
      Api.clearSession();
      location.href = '/index.html';
    };
    const sb = app.querySelector('#sidebar');
    app.querySelector('#menu-btn').onclick = () => {
      sb.classList.add('open');
      const bd = document.createElement('div');
      bd.className = 'sidebar-backdrop';
      bd.onclick = () => { sb.classList.remove('open'); bd.remove(); };
      document.body.appendChild(bd);
    };

    const refreshNet = () => {
      document.getElementById('net-pill').innerHTML = netPillHtml();
      document.getElementById('offline-banner').classList.toggle('hidden', Api.online);
    };
    Api.onStatus(async (online) => {
      refreshNet();
      if (online && Offline.count() && !Offline.syncing) {
        const r = await Offline.sync();
        if (r && r.synced) toast(`✅ Đã có mạng trở lại — đồng bộ ${r.synced} đơn offline`, 'success', 5000);
        if (r && r.failed) toast(`⚠️ ${r.failed} đơn offline đồng bộ lỗi, xem tại trang Bắt lỗi hệ thống`, 'warn', 6000);
        refreshNet();
      }
      if (online) Api.flushErrors();
    });
    refreshNet();
    // kiểm tra kết nối định kỳ; khi có mạng thì đồng bộ đơn offline + gửi log lỗi
    const tick = async () => {
      const ok = await Api.ping();
      if (ok) {
        if (Offline.count()) {
          const r = await Offline.sync();
          if (r && r.synced) toast(`✅ Đồng bộ ${r.synced} đơn offline`, 'success');
        }
        Api.flushErrors();
      }
      refreshNet();
    };
    tick();
    setInterval(tick, 15000);

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    return user;
  }

  window.UI = { init, toast, modal, confirmDialog, showError, table, esc, money, moneyShort, num, pct, dt, delta, today, dateAdd, ROLE_LABEL };
})();
