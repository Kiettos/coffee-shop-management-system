(function () {
  const user = UI.init({ title: 'Sản phẩm & công thức', roles: ['admin', 'manager'] });
  if (!user) return;
  const { esc, money, num, pct, table, toast, modal, showError, confirmDialog } = UI;
  const $ = (s) => document.querySelector(s);
  let products = []; let categories = []; let ingredients = []; let catFilter = 0;

  async function load() {
    try {
      [products, categories, ingredients] = await Promise.all([Api.get('/api/products'), Api.get('/api/categories'), Api.get('/api/ingredients')]);
    } catch (e) { return showError(e); }
    renderCats();
    renderProducts();
  }

  function renderCats() {
    $('#cats').innerHTML = [{ id: 0, name: 'Tất cả', product_count: products.filter((p) => p.active).length }, ...categories].map((c) =>
      `<button class="chip ${c.id === catFilter ? 'active' : ''}" data-id="${c.id}">${esc(c.name)} <span class="small">(${c.product_count})</span></button>`).join('');
    $('#cats').querySelectorAll('.chip').forEach((b) => {
      b.onclick = () => { catFilter = Number(b.dataset.id); renderCats(); renderProducts(); };
      if (b.dataset.id !== '0') b.ondblclick = () => catDialog(categories.find((c) => c.id === Number(b.dataset.id)));
    });
  }

  function renderProducts() {
    const q = $('#q').value.trim().toLowerCase();
    const rows = products.filter((p) => (!catFilter || p.category_id === catFilter) && ($('#show-inactive').checked || p.active) && (!q || p.name.toLowerCase().includes(q)));
    table($('#t-products'), [
      { key: 'name', label: 'Món', render: (p) => `<b>${esc(p.name)}</b>${p.active ? '' : ' <span class="badge neutral">Ngừng bán</span>'}` },
      { key: 'category', label: 'Danh mục' },
      { key: 'price', label: 'Giá bán', type: 'money' },
      { key: 'cost', label: 'Giá vốn (công thức)', type: 'money' },
      { key: 'profit', label: 'Lãi / ly', render: (p) => money(p.price - p.cost), sortValue: (p) => p.price - p.cost },
      { key: 'margin', label: 'Biên LN', render: (p) => `${pct(p.margin)} ${p.margin < 50 ? '<span class="badge warning">⚠ thấp</span>' : ''}`, sortValue: (p) => p.margin },
      { key: 'recipe', label: 'Công thức', sort: false, render: (p) => `<span class="small muted">${p.recipe.map((r) => `${esc(r.name)} ${num(r.quantity)}${esc(r.unit)}`).join(' · ') || '<span class="badge warning">⚠ chưa có công thức</span>'}</span>` },
      { key: 'can_make', label: 'Làm được', render: (p) => (p.can_make === null ? '—' : p.can_make === 0 ? '<span class="badge critical">✖ 0</span>' : `${num(p.can_make)} ly`), sortValue: (p) => p.can_make ?? 1e9 },
      { key: 'id', label: '', sort: false, cls: 'actions', render: (p) => `<button class="btn-sm" data-edit="${p.id}">Sửa</button>` },
    ], rows);
    document.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => productDialog(products.find((p) => p.id === Number(b.dataset.edit))); });
  }

  function catDialog(cat) {
    const isNew = !cat;
    const m = modal({
      title: isNew ? 'Thêm danh mục' : `Sửa danh mục: ${cat.name}`,
      body: `<div class="field"><label>Tên danh mục</label><input id="c-name" value="${esc(cat?.name || '')}"></div>
        <div class="field"><label>Thứ tự hiển thị</label><input id="c-sort" type="number" value="${cat?.sort ?? categories.length}"></div>`,
      foot: `${isNew ? '' : '<button class="btn-danger" data-a="del" style="margin-right:auto">Xóa</button>'}<button data-a="no">Hủy</button><button class="btn-primary" data-a="ok">Lưu</button>`,
    });
    m.$('[data-a=no]').onclick = m.close;
    m.$('[data-a=ok]').onclick = async () => {
      const body = { name: m.$('#c-name').value, sort: Number(m.$('#c-sort').value) };
      try { if (isNew) await Api.post('/api/categories', body); else await Api.put(`/api/categories/${cat.id}`, body); m.close(); toast('Đã lưu', 'success'); load(); } catch (e) { showError(e); }
    };
    const del = m.$('[data-a=del]');
    if (del) del.onclick = async () => {
      try { await Api.del(`/api/categories/${cat.id}`); m.close(); toast('Đã xóa', 'success'); catFilter = 0; load(); } catch (e) { showError(e); }
    };
  }

  function productDialog(p) {
    const isNew = !p;
    p = p || { name: '', price: 0, category_id: catFilter || categories[0]?.id, active: 1, recipe: [] };
    const ingOpts = (sel) => ingredients.map((i) => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)} (${esc(i.unit)})</option>`).join('');
    const rowHtml = (r = {}) => `<div class="recipe-row"><select class="r-ing">${ingOpts(r.ingredient_id)}</select>
      <input class="r-qty" type="number" min="0" step="any" value="${r.quantity ?? ''}" placeholder="Định lượng"><button class="btn-sm r-del" aria-label="Xóa">✕</button></div>`;
    const m = modal({
      title: isNew ? 'Thêm món mới' : `Sửa món: ${p.name}`, wide: true,
      body: `<div class="row"><div class="field" style="flex:2"><label>Tên món</label><input id="p-name" value="${esc(p.name)}"></div>
          <div class="field"><label>Danh mục</label><select id="p-cat">${categories.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Giá bán (đ)</label><input id="p-price" type="number" min="0" step="1000" value="${p.price}"></div></div>
        <label style="font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" id="p-active" ${p.active ? 'checked' : ''} style="width:auto;min-height:auto"> Đang bán</label>
        <h3 class="section-gap">Công thức pha chế (định lượng cho 1 ly / 1 phần)</h3>
        <div id="rows">${p.recipe.map(rowHtml).join('')}</div>
        <button class="btn-sm" id="add-row">➕ Thêm nguyên liệu</button>
        <div class="card section-gap" style="background:var(--brand-soft)" id="cost-box"></div>`,
      foot: `${isNew ? '' : '<button class="btn-danger" data-a="del" style="margin-right:auto">Xóa / ngừng bán</button>'}<button data-a="no">Hủy</button><button class="btn-primary" data-a="ok">Lưu</button>`,
    });
    const readRecipe = () => [...m.$$('#rows .recipe-row')].map((r) => ({ ingredient_id: Number(r.querySelector('.r-ing').value), quantity: Number(r.querySelector('.r-qty').value) })).filter((r) => r.quantity > 0);
    const updCost = () => {
      const cost = readRecipe().reduce((s, r) => s + r.quantity * (ingredients.find((i) => i.id === r.ingredient_id)?.cost_per_unit || 0), 0);
      const price = Number(m.$('#p-price').value) || 0;
      const margin = price ? ((price - cost) / price) * 100 : 0;
      m.$('#cost-box').innerHTML = `Giá vốn: <b>${money(cost)}</b> · Lãi / ly: <b>${money(price - cost)}</b> · Biên lợi nhuận: <b>${pct(margin)}</b>
        ${margin < 50 ? ' <span class="badge warning">⚠ Biên lợi nhuận thấp</span>' : ' <span class="badge good">✔ Tốt</span>'}`;
    };
    const bind = () => {
      m.$$('.r-del').forEach((b) => { b.onclick = () => { b.parentElement.remove(); updCost(); }; });
      m.$$('.r-ing, .r-qty').forEach((x) => { x.oninput = updCost; x.onchange = updCost; });
    };
    m.$('#add-row').onclick = () => { m.$('#rows').insertAdjacentHTML('beforeend', rowHtml()); bind(); };
    m.$('#p-price').oninput = updCost;
    bind(); updCost();
    m.$('[data-a=no]').onclick = m.close;
    m.$('[data-a=ok]').onclick = async () => {
      const body = { name: m.$('#p-name').value, category_id: Number(m.$('#p-cat').value), price: Number(m.$('#p-price').value), active: m.$('#p-active').checked, recipe: readRecipe() };
      if (!body.recipe.length && !(await confirmDialog('Món chưa có công thức — hệ thống sẽ không trừ kho và giá vốn = 0. Vẫn lưu?'))) return;
      try { if (isNew) await Api.post('/api/products', body); else await Api.put(`/api/products/${p.id}`, body); m.close(); toast('Đã lưu món', 'success'); load(); } catch (e) { showError(e); }
    };
    const del = m.$('[data-a=del]');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog(`Xóa món "${p.name}"? Nếu món đã có lịch sử bán, món sẽ được chuyển sang "Ngừng bán".`, { danger: true, ok: 'Xóa' }))) return;
      try { const r = await Api.del(`/api/products/${p.id}`); m.close(); toast(r.message || 'Đã xóa', 'success'); load(); } catch (e) { showError(e); }
    };
  }

  $('#q').oninput = renderProducts;
  $('#show-inactive').onchange = renderProducts;
  $('#btn-add').onclick = () => productDialog(null);
  $('#btn-cat').onclick = () => catDialog(null);
  load();
})();
