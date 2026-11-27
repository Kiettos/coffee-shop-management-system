/** Giá vốn sản phẩm tính từ công thức pha chế x giá vốn nguyên liệu */
const { all } = require('../config/db');

function productCostMap() {
  const rows = all(`
    SELECT p.id AS product_id, COALESCE(SUM(r.quantity * i.cost_per_unit), 0) AS cost
    FROM products p
    LEFT JOIN recipes r ON r.product_id = p.id
    LEFT JOIN ingredients i ON i.id = r.ingredient_id
    GROUP BY p.id`);
  return new Map(rows.map((r) => [r.product_id, r.cost]));
}

function productCost(productId) {
  return productCostMap().get(Number(productId)) || 0;
}

module.exports = { productCostMap, productCost };
