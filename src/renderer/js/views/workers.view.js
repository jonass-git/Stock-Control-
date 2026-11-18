(function (global) {
  const POSApp = (global.POSApp = global.POSApp || {});

  let workers = [];

  async function loadWorkers() {
    workers = await window.posAPI.listAllWorkers();
    renderWorkersTable();
  }

  function renderWorkersTable() {
    const { escapeHtml, formatCurrency, formatDateTime, formatNumber, getInitials } = POSApp.utils;
    const tbody = document.getElementById('workersTableBody');
    const currentSession = POSApp.getCurrentSession();

    if (workers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">No hay trabajadores registrados.</td></tr>';
      return;
    }

    tbody.innerHTML = workers
      .map((w) => {
        const isSelf = currentSession && currentSession.workerId === w.id;
        const rolePill = w.role === 'admin'
          ? '<span class="role-pill admin">Administrador</span>'
          : '<span class="role-pill seller">Vendedor</span>';
        const statusBadge = w.is_active
          ? '<span class="badge badge-ok">Activo</span>'
          : '<span class="badge badge-out">Desactivado</span>';

        return `
          <tr>
            <td data-label="Código"><strong>${escapeHtml(w.employee_code)}</strong></td>
            <td data-label="Trabajador">
              <div style="display:flex;align-items:center;gap:10px;">
                <div class="chip-avatar" style="background:${escapeHtml(w.avatar_color)}">${escapeHtml(getInitials(w.name))}</div>
                <div>
                  <div class="prod-title">${escapeHtml(w.name)} ${isSelf ? '<span style="font-size:0.72rem;color:var(--primary);">(Tú)</span>' : ''}</div>
                </div>
              </div>
            </td>
            <td data-label="Rol">${rolePill}</td>
            <td data-label="Ventas / Facturado">
              <div>
                <strong>${formatNumber(w.sales_count || 0)}</strong> tickets<br/>
                <span style="font-size:0.76rem;color:var(--text-muted);">${formatCurrency(w.total_sold || 0)}</span>
              </div>
            </td>
            <td data-label="Último Acceso" style="font-size:0.82rem;color:var(--text-muted);">${escapeHtml(formatDateTime(w.last_login_at))}</td>
            <td data-label="Estado">${statusBadge}</td>
            <td data-label="Acciones">
              <div class="row-actions">
                <button type="button" class="btn btn-outline btn-sm" data-worker-action="edit" data-id="${w.id}">Editar</button>
                <button type="button" class="btn btn-outline btn-sm" data-worker-action="reset-cred" data-id="${w.id}">PIN / Clave</button>
                <button
                  type="button"
                  class="btn ${w.is_active ? 'btn-danger-soft' : 'btn-success'} btn-sm"
                  data-worker-action="toggle-active"
                  data-id="${w.id}"
                  ${isSelf && w.is_active ? 'disabled title="No puedes desactivar tu propio usuario activo"' : ''}
                >
                  ${w.is_active ? 'Desactivar' : 'Reactivar'}
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function updateCredentialFieldLabel() {
    const role = document.getElementById('workerRole').value;
    const label = document.getElementById('workerCredentialLabel');
    const input = document.getElementById('workerCredential');
    if (role === 'admin') {
      label.textContent = 'Contraseña o PIN de Administrador (mín. 4 caracteres) *';
      input.placeholder = '';
    } else {
      label.textContent = 'PIN de acceso (4-6 dígitos) *';
      input.placeholder = '';
    }
  }

  function openWorkerModal(id = null) {
    const form = document.getElementById('workerForm');
    form.reset();
    document.getElementById('workerId').value = '';
    const credWrap = document.getElementById('workerCredentialField');
    const credInput = document.getElementById('workerCredential');

    if (id) {
      const w = workers.find((item) => item.id === Number(id));
      if (!w) return;
      document.getElementById('workerModalTitle').textContent = 'Editar Trabajador';
      document.getElementById('workerId').value = w.id;
      document.getElementById('workerName').value = w.name;
      document.getElementById('workerCode').value = w.employee_code;
      document.getElementById('workerRole').value = w.role;
      document.getElementById('workerColor').value = w.avatar_color || '#4f46e5';
      credWrap.classList.add('hidden');
      credInput.required = false;
    } else {
      document.getElementById('workerModalTitle').textContent = 'Nuevo Trabajador';
      document.getElementById('workerRole').value = 'seller';
      credWrap.classList.remove('hidden');
      credInput.required = true;
      updateCredentialFieldLabel();
    }

    POSApp.utils.openModal('workerModal');
    setTimeout(() => document.getElementById('workerName').focus(), 60);
  }

  async function saveWorker(e) {
    e.preventDefault();
    const id = document.getElementById('workerId').value;
    const payload = {
      name: document.getElementById('workerName').value.trim(),
      employee_code: document.getElementById('workerCode').value.trim(),
      role: document.getElementById('workerRole').value,
      avatar_color: document.getElementById('workerColor').value
    };

    try {
      if (id) {
        await window.posAPI.updateWorker(Number(id), payload);
        POSApp.utils.showToast('Datos del trabajador actualizados', 'success');
      } else {
        payload.credential = document.getElementById('workerCredential').value;
        await window.posAPI.createWorker(payload);
        POSApp.utils.showToast('Trabajador creado correctamente', 'success');
      }
      POSApp.utils.closeModal('workerModal');
      await loadWorkers();
      await POSApp.refreshTopbarSession();
    } catch (err) {
      POSApp.utils.showToast(err.message || 'No se pudo guardar el trabajador.', 'error');
    }
  }

  function openResetCredentialModal(id) {
    const w = workers.find((item) => item.id === Number(id));
    if (!w) return;
    document.getElementById('resetWorkerId').value = w.id;
    document.getElementById('resetWorkerInfo').textContent = `${w.name} (${w.employee_code}) · Rol: ${w.role === 'admin' ? 'Administrador' : 'Vendedor'}`;
    document.getElementById('resetCredLabel').textContent = w.role === 'admin'
      ? 'Nuevo PIN o contraseña (mín. 4 caracteres) *'
      : 'Nuevo PIN numérico (4-6 dígitos) *';
    document.getElementById('resetNewCredential').value = '';
    POSApp.utils.openModal('resetCredentialModal');
    setTimeout(() => document.getElementById('resetNewCredential').focus(), 60);
  }

  async function submitResetCredential(e) {
    e.preventDefault();
    const id = Number(document.getElementById('resetWorkerId').value);
    const newCredential = document.getElementById('resetNewCredential').value;
    try {
      await window.posAPI.resetWorkerCredential(id, newCredential);
      POSApp.utils.closeModal('resetCredentialModal');
      POSApp.utils.showToast('Credencial actualizada correctamente', 'success');
    } catch (err) {
      POSApp.utils.showToast(err.message || 'No se pudo actualizar la credencial.', 'error');
    }
  }

  async function toggleWorkerActive(id) {
    const w = workers.find((item) => item.id === Number(id));
    if (!w) return;
    const nextState = !w.is_active;
    const confirmed = await POSApp.utils.confirmDialog({
      title: nextState ? 'Reactivar trabajador' : 'Desactivar trabajador',
      message: nextState
        ? `¿Quieres volver a habilitar el acceso en mostrador para "${w.name}"?`
        : `¿Desactivar a "${w.name}"? No podrá iniciar turno en caja, pero todo su historial de ventas permanecerá intacto.`,
      confirmText: nextState ? 'Reactivar' : 'Desactivar',
      danger: !nextState
    });
    if (!confirmed) return;

    try {
      await window.posAPI.toggleWorkerActive(w.id, nextState);
      await loadWorkers();
      POSApp.utils.showToast(nextState ? 'Trabajador reactivado' : 'Trabajador desactivado', 'success');
    } catch (err) {
      POSApp.utils.showToast(err.message || 'No se pudo cambiar el estado del trabajador.', 'error');
    }
  }

  function init() {
    document.getElementById('btnNewWorker').addEventListener('click', () => openWorkerModal(null));
    document.getElementById('workerRole').addEventListener('change', updateCredentialFieldLabel);
    document.getElementById('workerForm').addEventListener('submit', saveWorker);
    document.getElementById('resetCredentialForm').addEventListener('submit', submitResetCredential);

    document.getElementById('workersTableBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-worker-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-worker-action');
      const id = Number(btn.getAttribute('data-id'));
      if (action === 'edit') openWorkerModal(id);
      else if (action === 'reset-cred') openResetCredentialModal(id);
      else if (action === 'toggle-active') toggleWorkerActive(id);
    });
  }

  POSApp.workersView = {
    init,
    loadWorkers
  };
})(window);
