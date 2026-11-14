(function (global) {
  const POSApp = (global.POSApp = global.POSApp || {});

  const THEME_KEY = 'control_stock_pos_theme_v1';
  let currentSession = null;
  let activeView = 'pos';

  const ROLE_TABS = {
    seller: [
      { id: 'pos', label: 'Mostrador / Caja' },
      { id: 'catalog-ro', label: 'Consultar Catálogo' },
      { id: 'my-shift', label: 'Mis Ventas del Turno' }
    ],
    admin: [
      { id: 'pos', label: 'Mostrador / Caja' },
      { id: 'inventory', label: 'Control de Stock' },
      { id: 'audit', label: 'Ventas y Kardex' },
      { id: 'workers', label: 'Trabajadores' },
      { id: 'backups', label: 'Backups' }
    ]
  };

  const VIEW_SECTIONS = {
    pos: 'viewPos',
    'catalog-ro': 'viewCatalogReadonly',
    'my-shift': 'viewMyShift',
    inventory: 'viewInventory',
    audit: 'viewAudit',
    workers: 'viewWorkers',
    backups: 'viewBackups'
  };

  function applySavedTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark') {
        document.body.classList.add('dark');
      }
    } catch {
      // Ignorar si no hay localStorage disponible
    }
  }

  function toggleTheme() {
    document.body.classList.toggle('dark');
    try {
      localStorage.setItem(THEME_KEY, document.body.classList.contains('dark') ? 'dark' : 'light');
    } catch {
      // Ignorar
    }
  }

  function renderNavTabs() {
    const tabs = ROLE_TABS[currentSession.role] || ROLE_TABS.seller;
    const nav = document.getElementById('mainNavTabs');
    nav.innerHTML = tabs
      .map((t) => `<button type="button" class="nav-tab ${activeView === t.id ? 'active' : ''}" data-nav-view="${t.id}">${t.label}</button>`)
      .join('');
  }

  function updateWorkerHeaderChip() {
    if (!currentSession) return;
    const avatar = document.getElementById('activeWorkerAvatar');
    avatar.textContent = POSApp.utils.getInitials(currentSession.name);
    avatar.style.background = currentSession.avatarColor || '#4f46e5';
    document.getElementById('activeWorkerName').textContent = currentSession.name;
    document.getElementById('activeWorkerRole').textContent =
      currentSession.role === 'admin' ? 'ADMINISTRADOR' : 'VENDEDOR';
  }

  async function switchView(viewId) {
    if (!currentSession) return;
    const allowedTabs = ROLE_TABS[currentSession.role] || ROLE_TABS.seller;
    if (!allowedTabs.some((t) => t.id === viewId)) {
      viewId = allowedTabs[0].id;
    }

    activeView = viewId;
    renderNavTabs();

    Object.entries(VIEW_SECTIONS).forEach(([key, sectionId]) => {
      const el = document.getElementById(sectionId);
      if (el) el.classList.toggle('hidden', key !== viewId);
    });

    try {
      if (viewId === 'pos' || viewId === 'catalog-ro') {
        await POSApp.posView.loadProducts();
      } else if (viewId === 'my-shift') {
        await POSApp.posView.loadMyShiftSales();
      } else if (viewId === 'inventory' && currentSession.role === 'admin') {
        await POSApp.inventoryView.loadInventory();
      } else if (viewId === 'audit' && currentSession.role === 'admin') {
        await POSApp.auditView.loadAuditData();
      } else if (viewId === 'workers' && currentSession.role === 'admin') {
        await POSApp.workersView.loadWorkers();
      } else if (viewId === 'backups' && currentSession.role === 'admin') {
        await POSApp.backupsView.loadBackupInfo();
      }
    } catch (err) {
      POSApp.utils.showToast(err.message || 'Error al cargar la vista.', 'error');
    }
  }

  async function enterAppSession(session) {
    currentSession = session;
    updateWorkerHeaderChip();

    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');

    // Por defecto: vendedor abre directo en Mostrador / Caja; admin abre en Control de Stock o Caja
    const initialView = session.role === 'admin' ? 'inventory' : 'pos';
    await switchView(initialView);
  }

  async function lockAndSwitchShift() {
    try {
      await window.posAPI.logout();
    } catch {
      // Ignorar
    }
    currentSession = null;
    POSApp.posView.resetOnLogout();
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    await POSApp.loginView.loadWorkers();
  }

  async function refreshTopbarSession() {
    const s = await window.posAPI.getSession();
    if (s) {
      currentSession = s;
      updateWorkerHeaderChip();
    }
  }

  function getCurrentSession() {
    return currentSession;
  }

  POSApp.getCurrentSession = getCurrentSession;
  POSApp.refreshTopbarSession = refreshTopbarSession;
  POSApp.handleForcedLogout = lockAndSwitchShift;

  async function bootstrap() {
    applySavedTheme();
    POSApp.utils.initModalClosers();
    POSApp.utils.initConfirmDialog();

    POSApp.loginView.init({ onLogin: enterAppSession });
    POSApp.posView.init();
    POSApp.inventoryView.init();
    POSApp.workersView.init();
    POSApp.auditView.init();
    POSApp.backupsView.init();

    document.getElementById('mainNavTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-nav-view]');
      if (!btn) return;
      switchView(btn.getAttribute('data-nav-view'));
    });

    document.getElementById('btnSwitchShift').addEventListener('click', lockAndSwitchShift);
    document.getElementById('btnToggleTheme').addEventListener('click', toggleTheme);
    document.getElementById('btnPrintReceipt').addEventListener('click', () => window.print());

    // Atajo rápido de mostrador: F12 bloquea/cambia turno en un clic
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F12' && currentSession) {
        e.preventDefault();
        lockAndSwitchShift();
      }
    });

    const existing = await window.posAPI.getSession();
    if (existing) {
      await enterAppSession(existing);
    } else {
      await POSApp.loginView.loadWorkers();
    }
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})(window);
