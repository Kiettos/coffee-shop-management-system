/* Tiện ích biểu đồ dùng Chart.js — bảng màu cố định theo thứ tự, nét mảnh, lưới nhạt, tooltip khi rê chuột */
(function () {
  const SERIES = ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#008a17', '#6a4ce2', '#ec4647'];
  // Thang tuần tự 1 màu (xanh) cho heatmap: nhạt -> đậm
  const SEQ = ['#cce3fd', '#b6d5f8', '#9dc8f7', '#84b9f3', '#6aabf1', '#519ced', '#338ced', '#257de0', '#2370cd', '#1b64be', '#1757ac', '#0f4a96', '#0e3d7e'];
  const INK = '#191919'; const INK2 = '#666666'; const GRID = '#e7e7e7';
  const instances = new Map();

  if (window.Chart) {
    Chart.defaults.font.family = getComputedStyle(document.documentElement).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = INK2;
    Chart.defaults.borderColor = GRID;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = '#222';
    Chart.defaults.plugins.tooltip.padding = 9;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.plugins.tooltip.titleColor = '#fff';
    Chart.defaults.plugins.tooltip.bodyColor = '#fff';
    Chart.defaults.interaction = { mode: 'index', intersect: false };
  }

  const moneyTick = (v) => UI.moneyShort(v);

  function make(canvasId, config) {
    if (!window.Chart) return null;
    const el = document.getElementById(canvasId);
    if (!el) return null;
    if (instances.has(canvasId)) instances.get(canvasId).destroy();
    const c = new Chart(el, config);
    instances.set(canvasId, c);
    return c;
  }

  /** Biểu đồ đường theo thời gian (1 hoặc nhiều chuỗi, cùng 1 trục) */
  function line(id, labels, series, { money = true } = {}) {
    return make(id, {
      type: 'line',
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.label, data: s.data, borderColor: SERIES[s.color ?? i], backgroundColor: SERIES[s.color ?? i],
          borderWidth: 2, pointRadius: labels.length > 40 ? 0 : 3, pointHoverRadius: 5, tension: 0.25,
          borderDash: s.dashed ? [5, 4] : undefined, fill: false,
        })),
      },
      options: {
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14 } },
          y: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { callback: money ? moneyTick : undefined } },
        },
        plugins: {
          legend: { display: series.length > 1, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, color: INK2 } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${money ? UI.money(ctx.parsed.y) : UI.num(ctx.parsed.y)}` } },
        },
      },
    });
  }

  /** Biểu đồ cột (ngang hoặc dọc), 1 chuỗi -> 1 màu; colorByIndex chỉ dùng khi mỗi cột là 1 thực thể có màu riêng */
  function bar(id, labels, data, { horizontal = false, money = true, label = 'Giá trị', colors, fmt } = {}) {
    const f = fmt || ((v) => (money ? UI.money(v) : UI.num(v)));
    return make(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label, data, backgroundColor: colors || SERIES[0], borderRadius: { topLeft: horizontal ? 0 : 4, topRight: 4, bottomRight: horizontal ? 4 : 0 },
          borderSkipped: 'start', maxBarThickness: 34, borderColor: '#fff', borderWidth: horizontal ? { top: 1, bottom: 1 } : { left: 1, right: 1 },
        }],
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        interaction: { mode: 'nearest', intersect: true, axis: horizontal ? 'y' : 'x' },
        scales: {
          [horizontal ? 'y' : 'x']: { grid: { display: false }, ticks: { autoSkip: !horizontal } },
          [horizontal ? 'x' : 'y']: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { callback: money ? moneyTick : undefined } },
        },
        plugins: { tooltip: { mode: 'nearest', intersect: false, callbacks: { label: (ctx) => ` ${label}: ${f(ctx.parsed[horizontal ? 'x' : 'y'])}` } } },
      },
    });
  }

  /** Heatmap giờ × thứ bằng bảng HTML, màu tuần tự 1 sắc độ + tooltip */
  function heatmap(el, hm, { unit = 'đơn', money = false } = {}) {
    const max = Math.max(...hm.matrix.flat(), 1);
    const color = (v) => (v <= 0 ? '#f4f4f4' : SEQ[Math.min(SEQ.length - 1, Math.floor((v / max) * (SEQ.length - 1)))]);
    const ink = (v) => (v / max > 0.5 ? '#fff' : INK);
    const fmt = (v) => (money ? UI.moneyShort(v) : v);
    el.innerHTML = `<div class="table-wrap"><table class="heatmap"><thead><tr><th></th>${hm.hours.map((h) => `<th>${h}h</th>`).join('')}</tr></thead>
      <tbody>${hm.days.map((d, i) => `<tr><th style="text-align:right">${d}</th>${hm.matrix[i].map((v, j) =>
        `<td class="cell" style="background:${color(v)};color:${ink(v)}" data-tip="${d}, ${hm.hours[j]}:00–${hm.hours[j] + 1}:00 · ${money ? UI.money(v) : `${v} ${unit}`}">${v ? fmt(v) : ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="heat-scale">Ít <span class="ramp">${SEQ.filter((_, i) => i % 2 === 0).map((c) => `<span style="background:${c}"></span>`).join('')}</span> Nhiều
      ${hm.peak.value ? ` · <b style="color:${INK}">Cao điểm nhất: ${hm.peak.day} lúc ${hm.peak.hour}h (${money ? UI.money(hm.peak.value) : `${hm.peak.value} ${unit}`})</b>` : ''}</div>`;
    let tip;
    el.querySelectorAll('td.cell').forEach((td) => {
      td.onmouseenter = () => { tip = document.createElement('div'); tip.className = 'tooltip'; tip.textContent = td.dataset.tip; document.body.appendChild(tip); };
      td.onmousemove = (e) => { if (tip) { tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY + 12}px`; } };
      td.onmouseleave = () => { tip?.remove(); tip = null; };
    });
  }

  window.Charts = { SERIES, SEQ, line, bar, heatmap, make };
})();
