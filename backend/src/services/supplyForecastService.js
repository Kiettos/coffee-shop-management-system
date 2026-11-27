/**
 * Dự báo nguồn cung nguyên liệu dựa trên tin tức / mạng xã hội.
 *  1. Thu thập tiêu đề tin (Google News RSS theo từ khóa) + văn bản người dùng dán vào (bài báo, post MXH...)
 *  2. Phân tích:
 *     - Có ANTHROPIC_API_KEY  -> dùng Claude để nhận diện xu hướng (pattern) giá & nguồn cung
 *     - Không có / lỗi mạng   -> bộ phân tích từ khóa nội bộ (luôn chạy được, kể cả offline)
 *  3. Kết hợp với tốc độ tiêu thụ hiện tại để đưa ra khuyến nghị nhập hàng.
 */
const { all } = require('../config/db');
const { stockForecast } = require('./reportService');

// Nhóm hàng hóa -> từ khóa nhận diện trong tin tức + nguyên liệu trong kho khớp theo tên
const COMMODITIES = [
  { key: 'coffee', label: 'Cà phê', words: ['cà phê', 'cafe', 'coffee', 'robusta', 'arabica'], match: /cà phê|cafe|coffee/i },
  { key: 'milk', label: 'Sữa', words: ['sữa', 'milk', 'bò sữa'], match: /sữa|milk|kem/i },
  { key: 'sugar', label: 'Đường', words: ['đường', 'sugar', 'mía'], match: /đường|syrup|sugar/i },
  { key: 'tea', label: 'Trà', words: ['trà', 'chè', 'tea'], match: /trà|tea|chè/i },
  { key: 'fruit', label: 'Trái cây', words: ['trái cây', 'chanh', 'cam', 'đào', 'dâu', 'xoài', 'fruit'], match: /chanh|cam|đào|dâu|xoài|trái/i },
  { key: 'flour', label: 'Bột / bánh', words: ['bột mì', 'lúa mì', 'wheat', 'bơ', 'trứng'], match: /bột|bánh|bơ|trứng/i },
  { key: 'packaging', label: 'Bao bì / ly nhựa', words: ['ly nhựa', 'nhựa', 'bao bì', 'plastic'], match: /ly|nắp|ống hút|túi/i },
];

const UP = ['tăng giá', 'tăng mạnh', 'tăng cao', 'đắt', 'khan hiếm', 'thiếu hụt', 'thiếu hàng', 'mất mùa', 'hạn hán',
  'el nino', 'bão', 'lũ', 'sương muối', 'giảm sản lượng', 'sản lượng giảm', 'xuất khẩu tăng', 'cháy hàng', 'sốt giá', 'lập đỉnh',
  'kỷ lục', 'đứt gãy', 'gián đoạn', 'thuế', 'rising', 'shortage', 'drought', 'record high', 'surge'];
const DOWN = ['giảm giá', 'hạ giá', 'giá giảm', 'giảm mạnh', 'dư thừa', 'bội thu', 'được mùa', 'sản lượng tăng', 'tồn kho cao',
  'rớt giá', 'lao dốc', 'oversupply', 'falling', 'bumper crop'];

const FEED_QUERIES = ['giá cà phê', 'giá sữa nguyên liệu', 'giá đường', 'giá trà nguyên liệu'];

async function fetchNews({ timeoutMs = 6000 } = {}) {
  const headlines = [];
  const errors = [];
  await Promise.all(FEED_QUERIES.map(async (q) => {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=vi&gl=VN&ceid=VN:vi`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'coffee-shop-management/1.0' } });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8);
      for (const m of items) {
        const title = decode((/<title>([\s\S]*?)<\/title>/.exec(m[1]) || [])[1] || '');
        const date = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(m[1]) || [])[1] || '';
        if (title) headlines.push({ query: q, title, date });
      }
    } catch (e) {
      errors.push(`${q}: ${e.name === 'AbortError' ? 'hết thời gian chờ' : e.message}`);
    }
  }));
  return { headlines, errors };
}

function decode(s) {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

/** Phân tích bằng từ khóa: đếm tín hiệu tăng/giảm giá theo từng nhóm hàng */
function keywordAnalysis(texts) {
  const docs = texts.map((t) => t.toLowerCase());
  return COMMODITIES.map((c) => {
    let up = 0; let down = 0; const evidence = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      if (!c.words.some((w) => d.includes(w))) continue;
      const u = UP.filter((w) => d.includes(w)).length;
      const dn = DOWN.filter((w) => d.includes(w)).length;
      if (u || dn) {
        up += u; down += dn;
        if (evidence.length < 3) evidence.push(texts[i].slice(0, 160));
      }
    }
    const score = up - down;
    const trend = score >= 2 ? 'up' : score <= -2 ? 'down' : (score === 1 ? 'slightly_up' : score === -1 ? 'slightly_down' : 'stable');
    const risk = score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';
    return { key: c.key, label: c.label, trend, risk, signals: { up, down }, evidence,
      reason: up + down === 0 ? 'Không có tín hiệu đáng kể trong dữ liệu thu thập' : `${up} tín hiệu tăng giá/khan hiếm, ${down} tín hiệu giảm giá/dư cung` };
  });
}

async function claudeAnalysis(texts, stockSummary) {
  // Lazy-load SDK: chỉ cần khi có API key
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const system = `Bạn là chuyên gia phân tích chuỗi cung ứng nguyên liệu cho quán cà phê tại Việt Nam.
Dựa trên tin tức/bài đăng mạng xã hội và tình hình kho, hãy nhận diện xu hướng (pattern) về giá và nguồn cung
cho từng nhóm hàng: ${COMMODITIES.map((c) => `${c.key} (${c.label})`).join(', ')}.
Chỉ trả lời bằng MỘT đối tượng JSON hợp lệ, không kèm giải thích bên ngoài, theo cấu trúc:
{"commodities":[{"key":"coffee","trend":"up|slightly_up|stable|slightly_down|down","risk":"high|medium|low",
"reason":"lý do ngắn gọn bằng tiếng Việt","evidence":["trích dẫn ngắn"]}],
"summary":"nhận định tổng quan 2-3 câu","actions":["khuyến nghị hành động cụ thể cho chủ quán"]}`;
  const user = `TÌNH HÌNH KHO HIỆN TẠI:\n${stockSummary}\n\nTIN TỨC / MẠNG XÃ HỘI THU THẬP ĐƯỢC:\n${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

  const response = await client.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Mô hình từ chối yêu cầu');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return json;
}

/** Ghép tín hiệu thị trường với nguyên liệu cụ thể trong kho để đưa ra khuyến nghị nhập hàng */
function recommendations(analysis) {
  const forecast = stockForecast();
  return forecast.map((f) => {
    const com = COMMODITIES.find((c) => c.match.test(f.name));
    const a = com && analysis.find((x) => x.key === com.key);
    let action = 'Nhập theo kế hoạch bình thường';
    let factor = 1;
    if (a && (a.trend === 'up' || a.risk === 'high')) { action = 'Nên nhập sớm, tăng dự trữ ~30% trước khi giá tăng'; factor = 1.3; }
    else if (a && a.trend === 'slightly_up') { action = 'Cân nhắc nhập sớm, tăng dự trữ ~15%'; factor = 1.15; }
    else if (a && (a.trend === 'down' || a.trend === 'slightly_down')) { action = 'Giá có xu hướng giảm: chỉ nhập đủ dùng, chờ giá tốt'; factor = 0.85; }
    if (f.status === 'out' || f.status === 'critical') action = `KHẨN: sắp hết hàng. ${action}`;
    return {
      ingredient: f.name, unit: f.unit, commodity: com?.label || '—', market_trend: a?.trend || 'stable', risk: a?.risk || 'low',
      days_left: f.days_left, status: f.status,
      suggest_import: Math.ceil(f.suggest_import * factor + (factor > 1 ? f.daily_usage * 14 * (factor - 1) : 0)), action,
    };
  });
}

async function analyzeSupply({ text = '', fetch: doFetch = true } = {}) {
  const userTexts = String(text || '').split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 10);
  let news = { headlines: [], errors: [] };
  if (doFetch) news = await fetchNews();
  const texts = [...userTexts, ...news.headlines.map((h) => h.title)];

  const stock = all('SELECT name, unit, stock, min_stock FROM ingredients ORDER BY name');
  const stockSummary = stock.map((s) => `- ${s.name}: tồn ${s.stock} ${s.unit} (tối thiểu ${s.min_stock})`).join('\n');

  let engine = 'keyword';
  let analysis = keywordAnalysis(texts);
  let summary = null;
  let actions = [];
  let aiError = null;

  if (process.env.ANTHROPIC_API_KEY && texts.length) {
    try {
      const ai = await claudeAnalysis(texts, stockSummary);
      if (Array.isArray(ai.commodities)) {
        analysis = COMMODITIES.map((c) => {
          const x = ai.commodities.find((k) => k.key === c.key) || {};
          const kw = analysis.find((k) => k.key === c.key);
          return { key: c.key, label: c.label, trend: x.trend || 'stable', risk: x.risk || 'low',
            reason: x.reason || kw.reason, evidence: x.evidence || kw.evidence, signals: kw.signals };
        });
        summary = ai.summary || null;
        actions = Array.isArray(ai.actions) ? ai.actions : [];
        engine = 'claude';
      }
    } catch (e) {
      aiError = `Không gọi được AI (${e.message}). Đang dùng bộ phân tích từ khóa.`;
    }
  }

  if (!summary) {
    const hot = analysis.filter((a) => a.risk !== 'low');
    summary = !texts.length
      ? 'Chưa có dữ liệu tin tức (mất mạng hoặc chưa nhập văn bản). Khuyến nghị dựa trên tốc độ tiêu thụ hiện tại.'
      : hot.length
        ? `Phát hiện tín hiệu rủi ro nguồn cung/giá với: ${hot.map((h) => h.label).join(', ')}.`
        : 'Chưa thấy tín hiệu bất thường về nguồn cung trong dữ liệu thu thập.';
  }

  return {
    engine, generated_at: new Date().toISOString(), summary, actions, ai_error: aiError,
    sources: { user_texts: userTexts.length, headlines: news.headlines, fetch_errors: news.errors },
    commodities: analysis,
    recommendations: recommendations(analysis),
  };
}

module.exports = { analyzeSupply, keywordAnalysis };
