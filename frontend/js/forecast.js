(function () {
  const user = UI.init({ title: 'Dự báo & AI', roles: ['admin', 'manager'] });
  if (!user) return;
  const { esc, money, num, table, showError } = UI;
  const $ = (s) => document.querySelector(s);

  const STATUS = {
    out: '<span class="badge critical">✖ Đã hết</span>', critical: '<span class="badge critical">⛔ Nguy cấp (≤3 ngày)</span>',
    warning: '<span class="badge warning">⚠ Sắp hết (≤7 ngày)</span>', ok: '<span class="badge good">✔ Ổn định</span>',
  };
  const TREND = {
    up: '<span class="badge critical">▲▲ Tăng giá / khan hiếm</span>', slightly_up: '<span class="badge warning">▲ Hơi tăng</span>',
    stable: '<span class="badge neutral">● Ổn định</span>', slightly_down: '<span class="badge info">▼ Hơi giảm</span>', down: '<span class="badge good">▼▼ Giảm giá / dư cung</span>',
  };
  const RISK = { high: '<span class="badge critical">⛔ Rủi ro cao</span>', medium: '<span class="badge warning">⚠ Trung bình</span>', low: '<span class="badge good">✔ Thấp</span>' };

  async function loadForecast() {
    try {
      const rows = await Api.get(`/api/reports/forecast?window=${$('#window').value}`);
      const cnt = (s) => rows.filter((r) => r.status === s).length;
      $('#f-kpis').innerHTML = `
        <div class="kpi"><div class="label">⛔ Nguy cấp / đã hết</div><div class="value">${cnt('critical') + cnt('out')}</div><span class="delta flat">hết trong ≤ 3 ngày</span></div>
        <div class="kpi"><div class="label">⚠ Sắp hết</div><div class="value">${cnt('warning')}</div><span class="delta flat">hết trong ≤ 7 ngày</span></div>
        <div class="kpi"><div class="label">✔ Ổn định</div><div class="value">${cnt('ok')}</div></div>
        <div class="kpi"><div class="label">Chi phí nhập gợi ý</div><div class="value">${money(rows.reduce((s, r) => s + r.suggest_cost, 0))}</div><span class="delta flat">đủ dùng 14 ngày</span></div>`;
      const urgent = rows.filter((r) => r.days_left !== null).slice(0, 12);
      Charts.bar('c-days', urgent.map((r) => r.name), urgent.map((r) => Math.min(r.days_left, 60)), {
        horizontal: true, money: false, label: 'Số ngày còn đủ dùng', fmt: (v) => `${num(v, 1)} ngày`,
        colors: urgent.map((r) => (r.status === 'critical' || r.status === 'out' ? '#dc3c3d' : r.status === 'warning' ? '#fbb315' : '#257de0')),
      });
      table($('#t-forecast'), [
        { key: 'name', label: 'Nguyên liệu' },
        { key: 'stock', label: 'Tồn kho', render: (r) => `${num(r.stock)} ${esc(r.unit)}`, sortValue: (r) => r.stock },
        { key: 'daily_usage', label: 'Dùng / ngày', render: (r) => `${num(r.daily_usage)} ${esc(r.unit)}`, sortValue: (r) => r.daily_usage },
        { key: 'trend_pct', label: 'Xu hướng gần đây', render: (r) => (r.trend_pct ? `${r.trend_pct > 0 ? '▲' : '▼'} ${num(Math.abs(r.trend_pct), 1)}%` : '—'), sortValue: (r) => r.trend_pct },
        { key: 'days_left', label: 'Còn đủ (ngày)', type: 'num' },
        { key: 'stockout_date', label: 'Ngày hết dự kiến', render: (r) => esc(r.stockout_date || '—') },
        { key: 'status', label: 'Trạng thái', render: (r) => STATUS[r.status], sortValue: (r) => ({ out: 0, critical: 1, warning: 2, ok: 3 }[r.status]) },
        { key: 'suggest_import', label: 'Gợi ý nhập', render: (r) => (r.suggest_import ? `${num(r.suggest_import)} ${esc(r.unit)}` : '—'), sortValue: (r) => r.suggest_import },
        { key: 'supplier', label: 'Nhà cung cấp' },
      ], rows);
    } catch (e) { showError(e, 'Không tải được dự báo'); }
  }

  async function analyze() {
    const btn = $('#btn-analyze');
    btn.disabled = true; btn.textContent = '⏳ Đang thu thập & phân tích...';
    $('#ai-result').innerHTML = '<p class="muted">Đang phân tích, có thể mất 10–30 giây...</p>';
    try {
      const r = await Api.post('/api/forecast/supply', { text: $('#news').value, fetch: $('#fetch').checked }, { timeout: 120000 });
      $('#ai-engine').textContent = r.engine === 'claude' ? '🤖 Phân tích bởi Claude AI' : '🔤 Bộ phân tích từ khóa';
      $('#ai-result').innerHTML = `
        ${r.ai_error ? `<p class="badge warning">⚠ ${esc(r.ai_error)}</p>` : ''}
        <div class="card" style="background:var(--brand-soft)"><b>Nhận định:</b> ${esc(r.summary)}
          ${r.actions.length ? `<ul>${r.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          <div class="small muted">Nguồn: ${r.sources.headlines.length} tiêu đề tin tức, ${r.sources.user_texts} đoạn văn bản bạn nhập
          ${r.sources.fetch_errors.length ? ` · không lấy được: ${esc(r.sources.fetch_errors.join('; '))}` : ''}</div></div>
        <h3 class="section-gap">Xu hướng theo nhóm hàng</h3>
        <div id="t-com"></div>
        <h3 class="section-gap">Khuyến nghị nhập hàng</h3>
        <div id="t-rec"></div>
        ${r.sources.headlines.length ? `<details class="section-gap"><summary><b>Tin tức đã thu thập (${r.sources.headlines.length})</b></summary>
          <ul class="small">${r.sources.headlines.map((h) => `<li>${esc(h.title)} <span class="muted">— ${esc(h.date)}</span></li>`).join('')}</ul></details>` : ''}`;
      table($('#t-com'), [
        { key: 'label', label: 'Nhóm hàng' },
        { key: 'trend', label: 'Xu hướng', render: (x) => TREND[x.trend] || esc(x.trend), sort: false },
        { key: 'risk', label: 'Rủi ro nguồn cung', render: (x) => RISK[x.risk] || esc(x.risk), sortValue: (x) => ({ high: 3, medium: 2, low: 1 }[x.risk]) },
        { key: 'reason', label: 'Lý do', sort: false },
        { key: 'evidence', label: 'Dẫn chứng', sort: false, render: (x) => (x.evidence || []).map((e) => `<div class="small muted">“${esc(e)}”</div>`).join('') },
      ], r.commodities);
      table($('#t-rec'), [
        { key: 'ingredient', label: 'Nguyên liệu' }, { key: 'commodity', label: 'Nhóm' },
        { key: 'market_trend', label: 'Thị trường', render: (x) => TREND[x.market_trend], sort: false },
        { key: 'days_left', label: 'Còn đủ (ngày)', type: 'num' },
        { key: 'status', label: 'Kho', render: (x) => STATUS[x.status], sortValue: (x) => ({ out: 0, critical: 1, warning: 2, ok: 3 }[x.status]) },
        { key: 'suggest_import', label: 'Nên nhập', render: (x) => (x.suggest_import ? `${num(x.suggest_import)} ${esc(x.unit)}` : '—'), sortValue: (x) => x.suggest_import },
        { key: 'action', label: 'Hành động', sort: false },
      ], r.recommendations);
    } catch (e) {
      showError(e);
      $('#ai-result').innerHTML = `<p class="badge critical">✖ ${esc(e.message)}</p>`;
    } finally {
      btn.disabled = false; btn.textContent = '🔍 Phân tích & dự báo';
    }
  }

  $('#window').onchange = loadForecast;
  $('#btn-analyze').onclick = analyze;
  Api.get('/api/settings').then((s) => { $('#ai-engine').textContent = s.ai_enabled ? '🤖 Claude AI đã bật' : '🔤 Chưa cấu hình AI — dùng phân tích từ khóa'; }).catch(() => {});
  loadForecast();
})();
