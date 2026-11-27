-- =============================================================
--  Coffee Shop Management System - SQLite schema
--  Được nạp tự động bởi backend/src/config/db.js khi khởi động.
-- =============================================================
PRAGMA foreign_keys = ON;

-- Nhân viên ----------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT    NOT NULL,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin','manager','cashier','barista')),
  phone         TEXT,
  hourly_wage   REAL    NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Danh mục & sản phẩm -------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  price       REAL    NOT NULL CHECK (price >= 0),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Kho nguyên liệu ------------------------------------------------
CREATE TABLE IF NOT EXISTS ingredients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  unit          TEXT NOT NULL,            -- g, ml, cái...
  stock         REAL NOT NULL DEFAULT 0,  -- tồn kho theo hệ thống (lý thuyết)
  min_stock     REAL NOT NULL DEFAULT 0,  -- ngưỡng cảnh báo
  cost_per_unit REAL NOT NULL DEFAULT 0,  -- giá vốn / 1 đơn vị
  supplier      TEXT
);

-- Công thức pha chế: 1 sản phẩm dùng bao nhiêu nguyên liệu
CREATE TABLE IF NOT EXISTS recipes (
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity      REAL    NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (product_id, ingredient_id)
);

-- Đơn hàng -------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT    NOT NULL UNIQUE,
  client_uuid    TEXT    UNIQUE,            -- chống trùng khi đồng bộ đơn offline
  employee_id    INTEGER NOT NULL REFERENCES employees(id),
  table_no       TEXT,
  status         TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  payment_method TEXT    CHECK (payment_method IN ('cash','qr')),
  subtotal       REAL    NOT NULL DEFAULT 0,
  discount       REAL    NOT NULL DEFAULT 0,
  total          REAL    NOT NULL DEFAULT 0,
  cost_total     REAL    NOT NULL DEFAULT 0,  -- giá vốn tại thời điểm bán
  note           TEXT,
  cancel_reason  TEXT,
  offline        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  paid_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  product_name  TEXT    NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  unit_price    REAL    NOT NULL,
  unit_cost     REAL    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','cancelled')),
  cancel_reason TEXT,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

-- Giao dịch thanh toán (để theo dõi thanh toán lỗi) ----------------
CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  method     TEXT    NOT NULL CHECK (method IN ('cash','qr')),
  amount     REAL    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN ('success','failed')),
  message    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Nhật ký kho: nhập / tiêu hao theo công thức / hoàn / điều chỉnh kiểm kê / hủy
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  type          TEXT    NOT NULL CHECK (type IN ('import','consume','return','adjust','waste')),
  quantity      REAL    NOT NULL,   -- có dấu: + vào kho, - ra kho
  unit_cost     REAL    NOT NULL DEFAULT 0,
  order_id      INTEGER REFERENCES orders(id),
  employee_id   INTEGER REFERENCES employees(id),
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_inv_tx ON inventory_transactions(ingredient_id, created_at);

-- Kiểm kê thực tế: so sánh tồn hệ thống với tồn đếm được
CREATE TABLE IF NOT EXISTS stock_counts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  system_qty    REAL    NOT NULL,
  counted_qty   REAL    NOT NULL,
  difference    REAL    NOT NULL,   -- counted - system (âm = thất thoát)
  unit_cost     REAL    NOT NULL,
  employee_id   INTEGER REFERENCES employees(id),
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Sự kiện "hết nguyên liệu" khi khách gọi món mà kho không đủ
CREATE TABLE IF NOT EXISTS stockout_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  ingredient_id INTEGER REFERENCES ingredients(id),
  employee_id INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Nhật ký lỗi hệ thống (không order được / thanh toán lỗi / mất mạng / lỗi server)
CREATE TABLE IF NOT EXISTS error_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK (type IN ('order','payment','network','system','client')),
  message     TEXT NOT NULL,
  detail      TEXT,
  employee_id INTEGER REFERENCES employees(id),
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Cấu hình hệ thống (giả lập lỗi cổng thanh toán, thông tin quán...)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
