/** Quản lý danh mục, sản phẩm và công thức pha chế */
const { all, get, run, transaction } = require('../config/db');
const { HttpError } = require('../middleware/errorHandler');
const { productCostMap } = require('../services/costService');

function withDetails(products) {
  const costs = productCostMap();
  const recipes = all(`SELECT r.product_id, r.ingredient_id, r.quantity, i.name, i.unit, i.stock, i.cost_per_unit
                       FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id`);
  return products.map((p) => {
    const recipe = recipes.filter((r) => r.product_id === p.id);
    // số ly tối đa làm được với tồn kho hiện tại
    const canMake = recipe.length ? Math.floor(Math.min(...recipe.map((r) => r.stock / r.quantity))) : null;
    const cost = costs.get(p.id) || 0;
    return { ...p, cost: Math.round(cost), margin: p.price ? Math.round(((p.price - cost) / p.price) * 1000) / 10 : 0,
      recipe, can_make: canMake === null ? null : Math.max(canMake, 0) };
  });
}

exports.listCategories = (_req, res) => {
  res.json(all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
                FROM categories c ORDER BY sort, id`));
};

exports.createCategory = (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw new HttpError(400, 'Tên danh mục không được trống');
  if (get('SELECT 1 FROM categories WHERE name = ?', name)) throw new HttpError(409, 'Danh mục đã tồn tại');
  const r = run('INSERT INTO categories (name, sort) VALUES (?, ?)', name, Number(req.body.sort) || 0);
  res.status(201).json(get('SELECT * FROM categories WHERE id = ?', Number(r.lastInsertRowid)));
};

exports.updateCategory = (req, res) => {
  const c = get('SELECT * FROM categories WHERE id = ?', req.params.id);
  if (!c) throw new HttpError(404, 'Không tìm thấy danh mục');
  run('UPDATE categories SET name = ?, sort = ? WHERE id = ?', req.body.name?.trim() || c.name, req.body.sort ?? c.sort, c.id);
  res.json(get('SELECT * FROM categories WHERE id = ?', c.id));
};

exports.deleteCategory = (req, res) => {
  if (get('SELECT 1 FROM products WHERE category_id = ?', req.params.id)) {
    throw new HttpError(409, 'Danh mục còn sản phẩm, hãy chuyển sản phẩm sang danh mục khác trước');
  }
  run('DELETE FROM categories WHERE id = ?', req.params.id);
  res.json({ ok: true });
};

exports.listProducts = (req, res) => {
  const onlyActive = req.query.active === '1';
  const rows = all(`SELECT p.*, c.name AS category FROM products p JOIN categories c ON c.id = p.category_id
                    ${onlyActive ? 'WHERE p.active = 1' : ''} ORDER BY c.sort, p.name`);
  res.json(withDetails(rows));
};

function validateProduct(body) {
  const name = String(body.name || '').trim();
  const price = Number(body.price);
  if (!name) throw new HttpError(400, 'Tên món không được trống');
  if (!(price >= 0)) throw new HttpError(400, 'Giá bán không hợp lệ');
  if (!get('SELECT 1 FROM categories WHERE id = ?', body.category_id)) throw new HttpError(400, 'Danh mục không hợp lệ');
  const recipe = Array.isArray(body.recipe) ? body.recipe : [];
  for (const r of recipe) {
    if (!get('SELECT 1 FROM ingredients WHERE id = ?', r.ingredient_id)) throw new HttpError(400, 'Nguyên liệu trong công thức không hợp lệ');
    if (!(Number(r.quantity) > 0)) throw new HttpError(400, 'Định lượng nguyên liệu phải lớn hơn 0');
  }
  return { name, price, category_id: Number(body.category_id), active: body.active === undefined ? 1 : (body.active ? 1 : 0), recipe };
}

function saveRecipe(conn, productId, recipe) {
  conn.prepare('DELETE FROM recipes WHERE product_id = ?').run(productId);
  const ins = conn.prepare(`INSERT INTO recipes (product_id, ingredient_id, quantity) VALUES (?, ?, ?)
                            ON CONFLICT(product_id, ingredient_id) DO UPDATE SET quantity = quantity + excluded.quantity`);
  for (const r of recipe) ins.run(productId, Number(r.ingredient_id), Number(r.quantity));
}

exports.createProduct = (req, res) => {
  const p = validateProduct(req.body || {});
  const id = transaction((conn) => {
    const r = conn.prepare('INSERT INTO products (name, category_id, price, active) VALUES (?, ?, ?, ?)').run(p.name, p.category_id, p.price, p.active);
    const pid = Number(r.lastInsertRowid);
    saveRecipe(conn, pid, p.recipe);
    return pid;
  });
  res.status(201).json(withDetails([get('SELECT p.*, c.name AS category FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=?', id)])[0]);
};

exports.updateProduct = (req, res) => {
  const cur = get('SELECT * FROM products WHERE id = ?', req.params.id);
  if (!cur) throw new HttpError(404, 'Không tìm thấy món');
  const p = validateProduct({ ...cur, ...req.body });
  transaction((conn) => {
    conn.prepare('UPDATE products SET name=?, category_id=?, price=?, active=? WHERE id=?').run(p.name, p.category_id, p.price, p.active, cur.id);
    if (Array.isArray(req.body.recipe)) saveRecipe(conn, cur.id, p.recipe);
  });
  res.json(withDetails([get('SELECT p.*, c.name AS category FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=?', cur.id)])[0]);
};

exports.deleteProduct = (req, res) => {
  const cur = get('SELECT * FROM products WHERE id = ?', req.params.id);
  if (!cur) throw new HttpError(404, 'Không tìm thấy món');
  // Món đã có lịch sử bán -> chỉ ngừng bán để giữ dữ liệu báo cáo
  if (get('SELECT 1 FROM order_items WHERE product_id = ?', cur.id)) {
    run('UPDATE products SET active = 0 WHERE id = ?', cur.id);
    return res.json({ ok: true, archived: true, message: 'Món đã có lịch sử bán nên được chuyển sang "Ngừng bán"' });
  }
  transaction((conn) => {
    conn.prepare('DELETE FROM stockout_events WHERE product_id = ?').run(cur.id);
    conn.prepare('DELETE FROM products WHERE id = ?').run(cur.id);
  });
  res.json({ ok: true });
};
