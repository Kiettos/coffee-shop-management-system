const rpt = require('../services/reportService');
const { toExcel, toPdf } = require('../services/exportService');
const { analyzeSupply } = require('../services/supplyForecastService');
const { HttpError } = require('../middleware/errorHandler');

const range = (req) => rpt.normalizeRange(req.query.from, req.query.to);

const handlers = {
  summary: (req) => rpt.summary(range(req)),
  timeseries: (req) => rpt.timeseries(range(req), req.query.group),
  payment: (req) => rpt.byPayment(range(req)),
  shift: (req) => rpt.byShift(range(req)),
  cashier: (req) => rpt.byCashier(range(req)),
  top: (req) => rpt.topProducts(range(req), Number(req.query.limit) || 10),
  profit: (req) => rpt.productProfit(range(req)),
  category: (req) => rpt.byCategory(range(req)),
  usage: (req) => rpt.ingredientUsage(range(req)),
  loss: (req) => rpt.lossReport(range(req)),
  forecast: (req) => rpt.stockForecast(Number(req.query.window) || 14),
  cancel: (req) => rpt.cancelStats(range(req)),
  heatmap: (req) => rpt.heatmap(range(req), req.query.metric),
  full: (req) => rpt.fullReport(req.query.from, req.query.to, req.query.group),
};

exports.report = (req, res) => {
  const h = handlers[req.params.name];
  if (!h) throw new HttpError(404, 'Không có báo cáo này');
  res.json(h(req));
};

exports.exportExcel = async (req, res) => {
  const rep = rpt.fullReport(req.query.from, req.query.to, req.query.group);
  const buf = await toExcel(rep);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bao-cao_${rep.range.from}_${rep.range.to}.xlsx"`);
  res.send(Buffer.from(buf));
};

exports.exportPdf = (req, res) => {
  const rep = rpt.fullReport(req.query.from, req.query.to, req.query.group);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="bao-cao_${rep.range.from}_${rep.range.to}.pdf"`);
  toPdf(rep, res);
};

exports.supply = async (req, res) => {
  res.json(await analyzeSupply({ text: req.body?.text, fetch: req.body?.fetch !== false }));
};
