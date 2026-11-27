/**
 * Coffee Shop Management System - web server
 * Phục vụ cả REST API (/api) và giao diện web (thư mục frontend) trên cùng một cổng.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const { getDb } = require('./config/db');
const { errorHandler } = require('./middleware/errorHandler');
const { seedIfEmpty } = require('./db/seed');

const FRONTEND = path.resolve(__dirname, '..', '..', 'frontend');

function createApp() {
  getDb();
  seedIfEmpty();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Thư viện biểu đồ phục vụ từ node_modules để chạy được cả khi không có Internet
  app.use('/vendor', express.static(path.dirname(require.resolve('chart.js')), { maxAge: '7d' }));

  app.use('/api/auth', require('./routes/authRoutes'));
  app.use('/api', require('./routes/apiRoutes'));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API không tồn tại' }));

  app.use(express.static(FRONTEND, { extensions: ['html'] }));
  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, '0.0.0.0', () => {
    const nets = require('os').networkInterfaces();
    const lan = Object.values(nets).flat().find((n) => n && n.family === 'IPv4' && !n.internal);
    console.log(`\n☕  Coffee Shop Management đang chạy:`);
    console.log(`   Máy này      : http://localhost:${port}`);
    if (lan) console.log(`   Điện thoại/LAN: http://${lan.address}:${port}`);
    console.log('   Tài khoản mẫu: admin/admin123 · quanly/quanly123 · thungan1/123456\n');
  });
}

module.exports = { createApp };
