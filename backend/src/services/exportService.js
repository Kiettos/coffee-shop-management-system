/**
 * Xuất báo cáo ra Excel (exceljs) và PDF (pdfkit + font DejaVu hỗ trợ tiếng Việt).
 */
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { getSettings } = require('./settingsService');

const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')} đ`;
const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 2 }));
const pctText = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${num(n)}%`);
const STATUS = { out: 'Đã hết', critical: 'Nguy cấp', warning: 'Sắp hết', ok: 'Ổn định' };

/** Mỗi section: tiêu đề + cột + dòng. type của cột: money | num | pct | text */
function buildSections(rep) {
  const s = rep.summary;
  return [
    {
      title: 'Tổng quan & so sánh kỳ trước',
      note: `Kỳ này: ${s.range.from} → ${s.range.to} (${s.range.days} ngày) · Kỳ trước: ${s.previous_range.from} → ${s.previous_range.to}`,
      columns: [['Chỉ số', 'text', 28], ['Kỳ này', 'text', 18], ['Kỳ trước', 'text', 18], ['Tăng/giảm', 'text', 14]],
      rows: [
        ['Doanh thu', money(s.current.revenue), money(s.previous.revenue), pctText(s.change.revenue)],
        ['Số đơn', num(s.current.orders), num(s.previous.orders), pctText(s.change.orders)],
        ['Số món bán ra', num(s.current.items_sold), num(s.previous.items_sold), pctText(s.change.items_sold)],
        ['Giá trị TB / đơn', money(s.current.avg_order), money(s.previous.avg_order), pctText(s.change.avg_order)],
        ['Giá vốn', money(s.current.cost), money(s.previous.cost), pctText(s.change.cost)],
        ['Lợi nhuận gộp', money(s.current.profit), money(s.previous.profit), pctText(s.change.profit)],
        ['Biên lợi nhuận', `${num(s.current.margin)}%`, `${num(s.previous.margin)}%`, ''],
        ['Đơn bị hủy', num(s.current.cancelled_orders), num(s.previous.cancelled_orders), ''],
      ],
    },
    {
      title: 'Doanh thu theo thời gian',
      columns: [['Kỳ', 'text', 14], ['Số đơn', 'num', 10], ['Doanh thu', 'money', 18], ['Lợi nhuận', 'money', 18], ['So kỳ liền trước', 'pct', 16]],
      rows: rep.timeseries.map((t) => [t.period, t.orders, t.revenue, t.profit, t.change]),
    },
    {
      title: 'Theo phương thức thanh toán',
      columns: [['Phương thức', 'text', 20], ['Số đơn', 'num', 10], ['Doanh thu', 'money', 18], ['Tỷ trọng', 'pct0', 12], ['GD lỗi', 'num', 10]],
      rows: rep.payment.map((p) => [p.label, p.orders, p.revenue, p.share, p.failed]),
    },
    {
      title: 'Theo ca làm việc',
      columns: [['Ca', 'text', 22], ['Số đơn', 'num', 10], ['Doanh thu', 'money', 18], ['Lợi nhuận', 'money', 18], ['TB / đơn', 'money', 16]],
      rows: rep.shift.map((x) => [x.label, x.orders, x.revenue, x.profit, x.avg_order]),
    },
    {
      title: 'Theo nhân viên thu ngân',
      columns: [['Nhân viên', 'text', 22], ['Số đơn', 'num', 9], ['Doanh thu', 'money', 16], ['Tiền mặt', 'money', 16], ['QR', 'money', 16], ['Đơn hủy', 'num', 9]],
      rows: rep.cashier.map((c) => [c.name, c.orders, c.revenue, c.cash, c.qr, c.cancelled]),
    },
    {
      title: 'Top 10 món bán chạy',
      columns: [['Món', 'text', 26], ['Danh mục', 'text', 14], ['SL bán', 'num', 9], ['Doanh thu', 'money', 16], ['Lợi nhuận', 'money', 16]],
      rows: rep.top.best.map((p) => [p.name, p.category, p.qty, p.revenue, p.profit]),
    },
    {
      title: 'Top 10 món bán chậm',
      columns: [['Món', 'text', 26], ['Danh mục', 'text', 14], ['SL bán', 'num', 9], ['Doanh thu', 'money', 16], ['Lợi nhuận', 'money', 16]],
      rows: rep.top.worst.map((p) => [p.name, p.category, p.qty, p.revenue, p.profit]),
    },
    {
      title: 'Lợi nhuận theo món (giá bán − giá vốn theo công thức)',
      columns: [['Món', 'text', 24], ['Giá bán', 'money', 12], ['Giá vốn', 'money', 12], ['LN / ly', 'money', 12], ['Biên LN', 'pct0', 9], ['SL', 'num', 7], ['Tổng LN', 'money', 14]],
      rows: rep.profit.map((p) => [p.name, p.price, p.unit_cost, p.unit_profit, p.unit_margin, p.qty, p.profit]),
    },
    {
      title: 'Theo danh mục',
      columns: [['Danh mục', 'text', 20], ['SL bán', 'num', 10], ['Doanh thu', 'money', 18], ['Lợi nhuận', 'money', 18], ['Tỷ trọng', 'pct0', 12]],
      rows: rep.category.map((c) => [c.name, c.qty, c.revenue, c.profit, c.share]),
    },
    {
      title: 'Nguyên liệu tiêu hao trong kỳ',
      columns: [['Nguyên liệu', 'text', 22], ['ĐVT', 'text', 7], ['Đã dùng', 'num', 12], ['TB / ngày', 'num', 11], ['Giá trị', 'money', 15], ['Nhập', 'num', 11], ['Tồn', 'num', 11]],
      rows: rep.usage.map((u) => [u.name, u.unit, u.used, u.avg_per_day, u.used_value, u.imported, u.stock]),
    },
    {
      title: 'Lý thuyết vs thực tế (chênh lệch = thất thoát)',
      note: `Tổng giá trị thất thoát: ${money(rep.loss.total_loss_value)} · Tỷ lệ thất thoát: ${num(rep.loss.loss_rate)}%`,
      columns: [['Nguyên liệu', 'text', 20], ['ĐVT', 'text', 6], ['Lý thuyết', 'num', 11], ['Thực tế', 'num', 11], ['Hủy/hỏng', 'num', 10], ['Lệch kiểm kê', 'num', 11], ['Thất thoát %', 'pct0', 10], ['Giá trị', 'money', 13]],
      rows: rep.loss.rows.map((l) => [l.name, l.unit, l.theoretical, l.actual, l.wasted, l.count_diff, l.loss_pct, l.loss_value]),
    },
    {
      title: 'Dự báo ngày hết hàng',
      columns: [['Nguyên liệu', 'text', 20], ['Tồn', 'num', 10], ['Dùng / ngày', 'num', 11], ['Còn (ngày)', 'num', 10], ['Ngày hết dự kiến', 'text', 15], ['Trạng thái', 'text', 11], ['Gợi ý nhập', 'num', 11]],
      rows: rep.forecast.map((f) => [`${f.name} (${f.unit})`, f.stock, f.daily_usage, f.days_left, f.stockout_date || '—', STATUS[f.status], f.suggest_import]),
    },
    {
      title: 'Tỷ lệ món bị hủy & hết nguyên liệu',
      note: `Tổng: hủy ${num(rep.cancel.total.cancel_rate)}% · hết nguyên liệu ${num(rep.cancel.total.stockout_rate)}%`,
      columns: [['Món', 'text', 24], ['Đã gọi', 'num', 10], ['Bị hủy', 'num', 10], ['Tỷ lệ hủy', 'pct0', 11], ['Lần hết NL', 'num', 11], ['Tỷ lệ hết NL', 'pct0', 12]],
      rows: rep.cancel.rows.map((c) => [c.name, c.ordered, c.cancelled, c.cancel_rate, c.stockouts, c.stockout_rate]),
    },
    {
      title: 'Giờ cao điểm (số đơn theo giờ × thứ)',
      note: rep.heatmap.peak.value ? `Cao điểm nhất: ${rep.heatmap.peak.day} lúc ${rep.heatmap.peak.hour}h (${rep.heatmap.peak.value} đơn)` : '',
      columns: [['Thứ', 'text', 10], ...rep.heatmap.hours.map((h) => [`${h}h`, 'num', 5])],
      rows: rep.heatmap.days.map((d, i) => [d, ...rep.heatmap.matrix[i]]),
      wide: true,
    },
  ];
}

function fmtCell(v, type) {
  if (type === 'money') return money(v);
  if (type === 'pct') return pctText(v);
  if (type === 'pct0') return `${num(v)}%`;
  if (type === 'num') return num(v);
  return v === null || v === undefined ? '' : String(v);
}

/* ------------------------------ EXCEL ------------------------------ */
async function toExcel(rep) {
  const shop = getSettings();
  const wb = new ExcelJS.Workbook();
  wb.creator = shop.shop_name;
  wb.created = new Date();
  const sections = buildSections(rep);

  // Sheet tổng hợp chứa tất cả
  const sheetNames = new Set();
  const safeName = (t) => {
    let n = t.replace(/[\\/?*[\]:]/g, '').slice(0, 28);
    while (sheetNames.has(n)) n = `${n.slice(0, 26)}_${sheetNames.size}`;
    sheetNames.add(n);
    return n;
  };

  for (const sec of sections) {
    const ws = wb.addWorksheet(safeName(sec.title));
    ws.addRow([`${shop.shop_name} — ${sec.title}`]).font = { bold: true, size: 14 };
    ws.addRow([`Kỳ báo cáo: ${rep.range.from} → ${rep.range.to}`]).font = { italic: true, color: { argb: 'FF666666' } };
    if (sec.note) ws.addRow([sec.note]).font = { italic: true };
    ws.addRow([]);
    const header = ws.addRow(sec.columns.map((c) => c[0]));
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6F4E37' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    for (const row of sec.rows) {
      const r = ws.addRow(row.map((v, i) => {
        const t = sec.columns[i][1];
        if (t === 'text') return v ?? '';
        if (v === null || v === undefined) return '';
        return (t === 'pct' || t === 'pct0') ? Number(v) / 100 : Number(v);
      }));
      r.eachCell((cell, col) => {
        const t = sec.columns[col - 1][1];
        if (t === 'money') cell.numFmt = '#,##0 "đ"';
        else if (t === 'pct') cell.numFmt = '+0.0%;-0.0%;0%';
        else if (t === 'pct0') cell.numFmt = '0.0%';
        else if (t === 'num') cell.numFmt = '#,##0.##';
      });
    }
    sec.columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(c[2] || 12, 8); });
    ws.views = [{ state: 'frozen', ySplit: header.number }];
  }
  return wb.xlsx.writeBuffer();
}

/* ------------------------------- PDF ------------------------------- */
function toPdf(rep, res) {
  const shop = getSettings();
  const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true, info: { Title: `Báo cáo ${rep.range.from} - ${rep.range.to}` } });
  doc.registerFont('R', FONT);
  doc.registerFont('B', FONT_BOLD);
  doc.pipe(res);

  const brand = '#6F4E37';
  doc.font('B').fontSize(18).fillColor(brand).text(shop.shop_name, { align: 'center' });
  doc.font('R').fontSize(9).fillColor('#666').text(shop.shop_address, { align: 'center' });
  doc.moveDown(0.5);
  doc.font('B').fontSize(15).fillColor('#222').text('BÁO CÁO KINH DOANH & PHÂN TÍCH DỮ LIỆU', { align: 'center' });
  doc.font('R').fontSize(10).fillColor('#444')
    .text(`Kỳ báo cáo: ${rep.range.from} → ${rep.range.to}  ·  Xuất lúc: ${new Date().toLocaleString('vi-VN')}`, { align: 'center' });
  doc.moveDown(1);

  for (const sec of buildSections(rep)) drawSection(doc, sec, brand);

  // đánh số trang
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('R').fontSize(8).fillColor('#999')
      .text(`Trang ${i + 1}/${range.count}`, 36, doc.page.height - 30, { width: doc.page.width - 72, align: 'right', lineBreak: false });
  }
  doc.end();
}

function drawSection(doc, sec, brand) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const fontSize = sec.wide ? 6.5 : 8;
  const totalW = sec.columns.reduce((s, c) => s + (c[2] || 12), 0);
  const widths = sec.columns.map((c) => ((c[2] || 12) / totalW) * width);
  const rowH = fontSize + 7;

  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.font('B').fontSize(11.5).fillColor(brand).text(sec.title, left, doc.y);
  if (sec.note) doc.font('R').fontSize(8.5).fillColor('#555').text(sec.note);
  doc.moveDown(0.3);

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(left, y, width, rowH + 2).fill(brand);
    let x = left;
    doc.font('B').fontSize(fontSize).fillColor('#fff');
    sec.columns.forEach((c, i) => {
      doc.text(c[0], x + 3, y + 4, { width: widths[i] - 6, align: c[1] === 'text' ? 'left' : 'right', lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + rowH + 2;
  };
  drawHeader();

  if (!sec.rows.length) {
    doc.font('R').fontSize(fontSize).fillColor('#888').text('Không có dữ liệu trong kỳ', left + 3, doc.y + 3);
    doc.moveDown(1);
    return;
  }

  sec.rows.forEach((row, ri) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 10) { doc.addPage(); drawHeader(); }
    const y = doc.y;
    if (ri % 2) doc.rect(left, y, width, rowH).fill('#F6F1EC');
    let x = left;
    doc.font('R').fontSize(fontSize).fillColor('#222');
    row.forEach((v, i) => {
      const t = sec.columns[i][1];
      doc.text(fmtCell(v, t), x + 3, y + 3.5, { width: widths[i] - 6, align: t === 'text' ? 'left' : 'right', lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + rowH;
  });
  doc.x = left;
  doc.moveDown(1.2);
}

module.exports = { toExcel, toPdf, buildSections };
