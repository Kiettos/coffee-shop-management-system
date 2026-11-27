/** Tiện ích ngày giờ theo giờ địa phương, định dạng giống SQLite: 'YYYY-MM-DD HH:MM:SS' */
const pad = (n) => String(n).padStart(2, '0');

function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDateTime(d) {
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);

/**
 * Chuẩn hóa khoảng thời gian báo cáo.
 * Trả về from/to (bao gồm cả 2 đầu), khoảng SQL [start, end) và kỳ trước có cùng độ dài.
 */
function normalizeRange(fromStr, toStr) {
  const today = new Date();
  let to = parseDate(toStr) || new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let from = parseDate(fromStr) || addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  const len = Math.round((to - from) / 86400000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  return {
    from: fmtDate(from),
    to: fmtDate(to),
    days: len,
    start: `${fmtDate(from)} 00:00:00`,
    end: `${fmtDate(addDays(to, 1))} 00:00:00`,
    prev: {
      from: fmtDate(prevFrom),
      to: fmtDate(prevTo),
      start: `${fmtDate(prevFrom)} 00:00:00`,
      end: `${fmtDate(from)} 00:00:00`,
    },
  };
}

module.exports = { pad, fmtDate, fmtDateTime, parseDate, addDays, daysBetween, normalizeRange };
