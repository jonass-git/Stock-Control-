(function (global) {
  const POSApp = (global.POSApp = global.POSApp || {});

  let workersList = [];
  let selectedWorkerId = null;
  let onLoginCallback = null;

  function getSelectedWorker() {
    return workersList.find((w) => w.id === selectedWorkerId) || null;
  }

  function renderWorkerCards() {
    const grid = document.getElementById('loginWorkersGrid');
    const { escapeHtml, getInitials } = POSApp.utils;

    if (workersList.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:20px;">No hay trabajadores activos.</div>';
      return;
    }

    grid.innerHTML = workersList
      .map((w) => {
        const isSelected = w.id === selectedWorkerId;
        const roleLabel = w.role === 'admin' ? 'Administrador' : 'Vendedor';
        const roleClass = w.role === 'admin' ? 'admin' : 'seller';
        return `
          <button type="button" class="worker-card ${isSelected ? 'selected' : ''}" data-worker-id="${w.id}">
            <div class="worker-avatar" style="background:${escapeHtml(w.avatar_color)}">${escapeHtml(getInitials(w.name))}</div>
            <div>
              <div class="worker-card-name">${escapeHtml(w.name)}</div>
              <div class="worker-card-code">${escapeHtml(w.employee_code)}</div>
            </div>
            <span class="role-pill ${roleClass}">${roleLabel}</span>
          </button>
        `;
      })
      .join('');
  }

  function updateSelectedBanner() {
    const worker = getSelectedWorker();
    const avatarEl = document.getElementById('selWorkerAvatar');
    const nameEl = document.getElementById('selWorkerName');
    const metaEl = document.getElementById('selWorkerMeta');
    const labelEl = document.getElementById('loginCredentialLabel');
    const inputEl = document.getElementById('loginCredentialInput');

    if (!worker) {
      avatarEl.textContent = '--';
      avatarEl.style.background = '#64748b';
      nameEl.textContent = 'Selecciona un perfil';
      metaEl.textContent = 'Haz clic en una tarjeta a la izquierda';
      inputEl.disabled = true;
      return;
    }

    avatarEl.textContent = POSApp.utils.getInitials(worker.name);
    avatarEl.style.background = worker.avatar_color || '#4f46e5';
    nameEl.textContent = worker.name;
    metaEl.textContent = `${worker.employee_code} · ${worker.role === 'admin' ? 'Administrador (Control Total)' : 'Vendedor (Mostrador)'}`;

    if (worker.role === 'admin') {
      labelEl.textContent = 'Contraseña o PIN';
      inputEl.classList.add('text-mode');
      inputEl.placeholder = '';
    } else {
      labelEl.textContent = 'PIN de acceso';
      inputEl.classList.remove('text-mode');
      inputEl.placeholder = '';
    }

    inputEl.disabled = false;
    inputEl.focus();
  }

  function selectWorker(id) {
    selectedWorkerId = Number(id);
    document.getElementById('loginCredentialInput').value = '';
    hideError();
    renderWorkerCards();
    updateSelectedBanner();
  }

  function showError(msg) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function hideError() {
    const el = document.getElementById('loginError');
    el.textContent = '';
    el.classList.add('hidden');
  }

  async function loadWorkers() {
    workersList = await window.posAPI.getActiveWorkers();
    if (!selectedWorkerId || !workersList.some((w) => w.id === selectedWorkerId)) {
      selectedWorkerId = workersList.length > 0 ? workersList[0].id : null;
    }
    document.getElementById('loginCredentialInput').value = '';
    hideError();
    renderWorkerCards();
    updateSelectedBanner();
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    hideError();

    if (!selectedWorkerId) {
      showError('Selecciona primero un trabajador.');
      return;
    }

    const input = document.getElementById('loginCredentialInput');
    const credential = input.value;
    if (!credential) {
      showError('Introduce tu PIN o contraseña.');
      input.focus();
      return;
    }

    const btn = document.getElementById('loginSubmitBtn');
    btn.disabled = true;
    try {
      const session = await window.posAPI.login(selectedWorkerId, credential);
      input.value = '';
      if (typeof onLoginCallback === 'function') {
        await onLoginCallback(session);
      }
    } catch (err) {
      showError(err.message || 'Credenciales incorrectas.');
      input.value = '';
      input.focus();
    } finally {
      btn.disabled = false;
    }
  }

  function init({ onLogin }) {
    onLoginCallback = onLogin;

    document.getElementById('loginWorkersGrid').addEventListener('click', (e) => {
      const card = e.target.closest('[data-worker-id]');
      if (!card) return;
      selectWorker(card.getAttribute('data-worker-id'));
    });

    document.getElementById('numpadGrid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-key]');
      if (!btn) return;
      const input = document.getElementById('loginCredentialInput');
      if (input.disabled) return;
      hideError();

      const key = btn.getAttribute('data-key');
      if (key === 'clear') {
        input.value = '';
      } else if (key === 'backspace') {
        input.value = input.value.slice(0, -1);
      } else {
        input.value += key;
      }
      input.focus();
    });

    document.getElementById('loginForm').addEventListener('submit', handleLoginSubmit);
  }

  POSApp.loginView = {
    init,
    loadWorkers
  };
})(window);
