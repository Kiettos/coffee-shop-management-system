(function () {
  const user = UI.init({ title: 'Nhân viên', roles: ['admin', 'manager'] });
  if (!user) return;
  const { esc, table, toast, modal, showError, ROLE_LABEL } = UI;
  const $ = (s) => document.querySelector(s);
  let list = [];

  async function load() {
    try { list = await Api.get('/api/employees'); } catch (e) { return showError(e); }
    table($('#t-emp'), [
      { key: 'full_name', label: 'Họ tên', render: (e) => `<b>${esc(e.full_name)}</b>${e.id === user.id ? ' <span class="badge info">Bạn</span>' : ''}` },
      { key: 'username', label: 'Tên đăng nhập' },
      { key: 'role', label: 'Vai trò', render: (e) => esc(ROLE_LABEL[e.role]) },
      { key: 'phone', label: 'Điện thoại' },
      { key: 'hourly_wage', label: 'Lương / giờ', type: 'money' },
      { key: 'month_orders', label: 'Đơn tháng này', type: 'num' },
      { key: 'month_revenue', label: 'Doanh thu tháng này', type: 'money' },
      { key: 'active', label: 'Trạng thái', render: (e) => (e.active ? '<span class="badge good">✔ Đang làm</span>' : '<span class="badge neutral">✖ Đã khóa</span>') },
      { key: 'id', label: '', sort: false, cls: 'actions', render: (e) => `<button class="btn-sm" data-edit="${e.id}">Sửa</button>` },
    ], list);
    document.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => dialog(list.find((e) => e.id === Number(b.dataset.edit))); });
  }

  function dialog(emp) {
    const isNew = !emp;
    emp = emp || { full_name: '', username: '', role: 'cashier', phone: '', hourly_wage: 25000, active: 1 };
    const roles = Object.entries(ROLE_LABEL).filter(([k]) => k !== 'admin' || user.role === 'admin');
    const m = modal({
      title: isNew ? 'Thêm nhân viên' : `Sửa: ${emp.full_name}`,
      body: `<div class="field"><label>Họ tên</label><input id="e-name" value="${esc(emp.full_name)}"></div>
        <div class="row"><div class="field"><label>Tên đăng nhập</label><input id="e-user" value="${esc(emp.username)}" ${isNew ? '' : 'disabled'} autocapitalize="none"></div>
        <div class="field"><label>Vai trò</label><select id="e-role">${roles.map(([k, v]) => `<option value="${k}" ${k === emp.role ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
        <div class="row"><div class="field"><label>Điện thoại</label><input id="e-phone" value="${esc(emp.phone || '')}" inputmode="tel"></div>
        <div class="field"><label>Lương / giờ (đ)</label><input id="e-wage" type="number" min="0" step="1000" value="${emp.hourly_wage}"></div></div>
        <div class="field"><label>${isNew ? 'Mật khẩu' : 'Đặt lại mật khẩu (để trống nếu không đổi)'}</label><input id="e-pw" type="password" autocomplete="new-password"></div>
        ${isNew ? '' : `<label style="font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" id="e-active" ${emp.active ? 'checked' : ''} style="width:auto;min-height:auto"> Đang làm việc (bỏ chọn để khóa tài khoản)</label>`}`,
      foot: '<button data-a="no">Hủy</button><button class="btn-primary" data-a="ok">Lưu</button>',
    });
    m.$('[data-a=no]').onclick = m.close;
    m.$('[data-a=ok]').onclick = async () => {
      const body = { full_name: m.$('#e-name').value, role: m.$('#e-role').value, phone: m.$('#e-phone').value, hourly_wage: Number(m.$('#e-wage').value) };
      if (m.$('#e-pw').value) body.password = m.$('#e-pw').value;
      try {
        if (isNew) await Api.post('/api/employees', { ...body, username: m.$('#e-user').value });
        else await Api.put(`/api/employees/${emp.id}`, { ...body, active: m.$('#e-active').checked });
        toast('Đã lưu', 'success'); m.close(); load();
      } catch (e) { showError(e); }
    };
  }

  $('#btn-add').onclick = () => dialog(null);
  $('#btn-pw').onclick = async () => {
    try {
      await Api.post('/api/auth/change-password', { old_password: $('#old-pw').value, new_password: $('#new-pw').value });
      toast('Đã đổi mật khẩu', 'success'); $('#old-pw').value = ''; $('#new-pw').value = '';
    } catch (e) { showError(e); }
  };
  load();
})();
