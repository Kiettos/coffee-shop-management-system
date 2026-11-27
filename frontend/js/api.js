/* =====================================================================
   API client + phát hiện mất mạng + hàng đợi đơn offline
   ===================================================================== */
(function () {
  const TOKEN_KEY = 'csm_token';
  const USER_KEY = 'csm_user';
  const QUEUE_KEY = 'csm_offline_orders';
  const ERR_KEY = 'csm_pending_errors';

  class ApiError extends Error {
    constructor(message, status, data) { super(message); this.status = status; this.data = data || {}; }
  }
  class NetworkError extends Error {
    constructor(message) { super(message || 'Mất kết nối tới máy chủ'); this.network = true; }
  }

  const OUTAGE_KEY = 'csm_outage_start';
  const state = { online: navigator.onLine, listeners: new Set() };
  function setOnline(v) {
    // Ghi nhận 1 sự cố cho mỗi lần mất mạng (kèm thời lượng), kể cả khi tải lại trang giữa chừng
    if (!v && !localStorage.getItem(OUTAGE_KEY)) localStorage.setItem(OUTAGE_KEY, String(Date.now()));
    if (v && localStorage.getItem(OUTAGE_KEY)) {
      const start = Number(localStorage.getItem(OUTAGE_KEY));
      localStorage.removeItem(OUTAGE_KEY);
      const sec = Math.round((Date.now() - start) / 1000);
      Api.reportError('network', `Mất kết nối tới máy chủ trong ${sec >= 60 ? `${Math.round(sec / 60)} phút` : `${sec} giây`}`, {
        from: new Date(start).toLocaleString('sv-SE'), to: new Date().toLocaleString('sv-SE'), seconds: sec,
      });
    }
    if (state.online === v) return;
    state.online = v;
    state.listeners.forEach((fn) => fn(v));
  }

  const Api = {
    ApiError, NetworkError,
    get token() { return localStorage.getItem(TOKEN_KEY); },
    get user() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } },
    saveSession(token, user) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); },
    clearSession() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },
    get online() { return state.online; },
    onStatus(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); },

    async request(method, url, body, { timeout = 15000, raw = false } = {}) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', ...(Api.token ? { Authorization: `Bearer ${Api.token}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctrl.signal,
          cache: 'no-store',
        });
      } catch (e) {
        clearTimeout(timer);
        setOnline(false);
        throw new NetworkError(e.name === 'AbortError' ? 'Máy chủ phản hồi quá lâu (hết thời gian chờ)' : 'Mất kết nối mạng - không gọi được máy chủ');
      }
      clearTimeout(timer);
      // Service worker trả 503 + header này khi không có mạng
      if (res.status === 503 && res.headers.get('X-Offline') === '1') { setOnline(false); throw new NetworkError(); }
      setOnline(res.headers.get('X-Offline') !== 'cache'); // 'cache' = SW trả bản lưu tạm khi mất mạng
      if (raw) return res;
      let data = null;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
      if (res.status === 401 && !url.includes('/auth/login')) {
        Api.clearSession();
        location.href = `/index.html?expired=1&next=${encodeURIComponent(location.pathname)}`;
        throw new ApiError('Phiên đăng nhập hết hạn', 401, data);
      }
      if (!res.ok) throw new ApiError(data?.error || `Lỗi ${res.status}`, res.status, data);
      return data;
    },
    get: (u, o) => Api.request('GET', u, undefined, o),
    post: (u, b, o) => Api.request('POST', u, b ?? {}, o),
    put: (u, b, o) => Api.request('PUT', u, b ?? {}, o),
    del: (u, o) => Api.request('DELETE', u, undefined, o),

    /** Tải file có xác thực (Excel/PDF) */
    async download(url, filename) {
      const res = await Api.request('GET', url, undefined, { raw: true, timeout: 60000 });
      if (!res.ok) {
        let msg = `Lỗi ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
        throw new ApiError(msg, res.status);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },

    /** Kiểm tra kết nối thật tới server (navigator.onLine không đủ tin cậy) */
    async ping() {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const r = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(t);
        const ok = r.ok && r.headers.get('X-Offline') !== '1';
        setOnline(ok);
        return ok;
      } catch {
        setOnline(false);
        return false;
      }
    },

    /** Ghi nhận lỗi phía trình duyệt - gửi ngay nếu có mạng, không thì để dành */
    reportError(type, message, detail) {
      const list = JSON.parse(localStorage.getItem(ERR_KEY) || '[]');
      list.push({ type, message, detail, at: new Date().toLocaleString('sv-SE'), page: location.pathname });
      localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(-50)));
    },
    async flushErrors() {
      if (Api.flushing) return;
      const list = JSON.parse(localStorage.getItem(ERR_KEY) || '[]');
      if (!list.length || !Api.token) return;
      Api.flushing = true;
      try {
        await Api.post('/api/errors/client', { errors: list });
        // chỉ xóa những lỗi đã gửi; lỗi phát sinh trong lúc gửi được giữ lại
        const now = JSON.parse(localStorage.getItem(ERR_KEY) || '[]');
        localStorage.setItem(ERR_KEY, JSON.stringify(now.slice(list.length)));
      } catch { /* thử lại sau */ } finally {
        Api.flushing = false;
      }
    },
  };

  /* ---------------- Hàng đợi đơn offline ---------------- */
  const Offline = {
    list() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } },
    save(list) { localStorage.setItem(QUEUE_KEY, JSON.stringify(list)); state.listeners.forEach((fn) => fn(state.online)); },
    add(order) {
      const o = {
        ...order,
        client_uuid: order.client_uuid || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
        created_at: new Date().toLocaleString('sv-SE'), // 'YYYY-MM-DD HH:MM:SS' giờ địa phương
        offline_code: `OFF-${Date.now().toString(36).toUpperCase()}`,
      };
      Offline.save([...Offline.list(), o]);
      return o;
    },
    count() { return Offline.list().length; },
    syncing: false,
    /** Đẩy toàn bộ đơn offline lên server; giữ lại đơn lỗi */
    async sync() {
      if (Offline.syncing || !Offline.count() || !Api.token) return null;
      Offline.syncing = true;
      try {
        const list = Offline.list();
        const res = await Api.post('/api/orders/sync', { orders: list }, { timeout: 30000 });
        const done = new Set(res.results.filter((r) => r.ok).map((r) => r.client_uuid));
        const failed = list.filter((o) => !done.has(o.client_uuid)).map((o) => ({
          ...o, sync_error: res.results.find((r) => r.client_uuid === o.client_uuid)?.error,
        }));
        Offline.save(failed);
        return { synced: done.size, failed: failed.length };
      } catch (e) {
        if (!e.network) console.warn('Đồng bộ thất bại', e);
        return null;
      } finally {
        Offline.syncing = false;
      }
    },
    remove(uuid) { Offline.save(Offline.list().filter((o) => o.client_uuid !== uuid)); },
  };

  window.addEventListener('online', () => Api.ping());
  window.addEventListener('offline', () => setOnline(false));
  // Bắt lỗi JS không mong muốn để ghi nhật ký
  window.addEventListener('error', (e) => Api.reportError('client', e.message || 'Lỗi JavaScript', { src: e.filename, line: e.lineno }));
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason && (e.reason.network || e.reason instanceof ApiError)) return;
    Api.reportError('client', String(e.reason?.message || e.reason || 'Promise bị từ chối'), {});
  });

  window.Api = Api;
  window.Offline = Offline;
})();
