'use strict';


const API_BASE = 'api.php'; 


class API {
  static async call(action, data = {}) {
    try {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.message || 'Error desconocido');
      return result;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  static async register(name, username, password) {
    return this.call('register', { name, username, password });
  }

  static async login(username, password, role) {
    return this.call('login', { username, password, role });
  }

  static async getUsers() {
    return this.call('get_users');
  }

  static async updateUser(id, name, balance, password = null) {
    return this.call('update_user', { id, name, balance, password });
  }

  static async deleteUser(id) {
    return this.call('delete_user', { id });
  }

  static async unlockUser(id) {
    return this.call('unlock_user', { id });
  }

  static async createTransaction(userId, type, amount, destId, description) {
    return this.call('create_transaction', { userId, type, amount, destId, description });
  }

  static async getTransactions(userId = null) {
    return this.call('get_transactions', { userId });
  }

  static async getAuditLog() {
    return this.call('get_audit_log');
  }

  static async clearHistory() {
    return this.call('clear_history');
  }
}



class SecurityUtils {
  static sanitize(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  static isValidUsername(u) { return /^[a-zA-Z0-9._]{3,30}$/.test(u); }
  static isValidPassword(p) { return p && p.length >= 6; }
}



class Transaction {
  static RATES = { deposit: 0.001, withdrawal: 0.010, transfer: 0.005, payment: 0.008 };
  static LABELS = { deposit:'Depósito', withdrawal:'Retiro', transfer:'Transferencia', payment:'Pago' };
  static BADGES = { deposit:'b-deposit', withdrawal:'b-withdrawal', transfer:'b-transfer', payment:'b-payment' };

  static calcCommission(amount, type) {
    return parseFloat((amount * (this.RATES[type] || 0)).toFixed(2));
  }

  static calcTotal(amount, type) {
    const comm = this.calcCommission(amount, type);
    return type !== 'deposit' ? parseFloat((amount + comm).toFixed(2)) : amount;
  }
}



class Store {
  constructor() {
    this.users = [];
    this.transactions = [];
    this.auditLog = [];
    this.COLORS = ['#2d6a4f','#1d3557','#7b2d8b','#c05621','#1a535c','#3d405b','#6b3a2a','#2c5f2e'];
  }

  avatarColor(id) {
    const num = parseInt(id.toString().replace(/\D/g, ''));
    return this.COLORS[num % this.COLORS.length];
  }

  getInitials(name) {
    return name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  }

  async loadUsers() {
    const result = await API.getUsers();
    this.users = result.data;
  }

  async loadTransactions(userId = null) {
    const result = await API.getTransactions(userId);
    this.transactions = result.data;
  }

  async loadAuditLog() {
    const result = await API.getAuditLog();
    this.auditLog = result.data;
  }

  getUserById(id) {
    return this.users.find(u => u.id === id);
  }
}

const store = new Store();


class Auth {
  static currentRole = null;
  static currentUser = null;
  static selectedRole = 'user';
  static currentMode = 'login';

  static switchMode(mode) {
    this.currentMode = mode;
    document.getElementById('modeLogin').className    = 'auth-mode-btn' + (mode === 'login' ? ' active' : '');
    document.getElementById('modeRegister').className = 'auth-mode-btn' + (mode === 'register' ? ' active' : '');
    document.getElementById('loginView').style.display = mode === 'login' ? 'block' : 'none';
    document.getElementById('registerView').style.display = mode === 'register' ? 'block' : 'none';
    this._clearErrors();
  }

  static selectRole(role) {
    this.selectedRole = role;
    document.getElementById('roleBtnUser').className  = 'role-btn' + (role === 'user'  ? ' active-user'  : '');
    document.getElementById('roleBtnAdmin').className = 'role-btn' + (role === 'admin' ? ' active-admin' : '');
    const hint = document.getElementById('loginHint');
    if (role === 'admin') {
      hint.innerHTML = 'Admin: <strong>admin</strong> / <strong>admin123</strong>';
    } else {
      hint.innerHTML = 'Ingresa el usuario y contraseña<br>de tu cuenta registrada';
    }
    this._clearErrors();
  }

  static async login() {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;

    if (!username || !password) {
      this._showLoginError('Completa todos los campos.');
      return;
    }

    try {
      const result = await API.login(username, password, this.selectedRole);
      this.currentRole = result.data.role;
      this.currentUser = result.data.user;

      this._launchApp();
    } catch (error) {
      this._showLoginError(error.message);
    }
  }

  static async register() {
    const name = document.getElementById('regName').value.trim();
    const username = document.getElementById('regUsername').value.trim().toLowerCase();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regPasswordConfirm').value;

    this._clearErrors();

    if (!name || !username || !password || !confirm) {
      this._showRegisterError('Completa todos los campos.');
      return;
    }

    if (!SecurityUtils.isValidUsername(username)) {
      this._showRegisterError('Usuario inválido (3-30 chars, letras/números/./_).');
      return;
    }

    if (!SecurityUtils.isValidPassword(password)) {
      this._showRegisterError('Contraseña mínimo 6 caracteres.');
      return;
    }

    if (password !== confirm) {
      this._showRegisterError('Las contraseñas no coinciden.');
      return;
    }

    try {
      await API.register(name, username, password);
      
      document.getElementById('regName').value = '';
      document.getElementById('regUsername').value = '';
      document.getElementById('regPassword').value = '';
      document.getElementById('regPasswordConfirm').value = '';

      this._showRegisterSuccess('¡Cuenta creada! Ya puedes iniciar sesión.');
      
      setTimeout(() => {
        this.switchMode('login');
      }, 2000);
    } catch (error) {
      this._showRegisterError(error.message);
    }
  }

  static logout() {
    this.currentRole = null;
    this.currentUser = null;
    document.getElementById('appShell').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    this._clearInputs();
    this._clearErrors();
    this.switchMode('login');
    this.selectRole('user');
  }

  static _showLoginError(msg) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.classList.add('visible');
  }

  static _showRegisterError(msg) {
    const el = document.getElementById('registerError');
    el.textContent = msg;
    el.classList.add('visible');
  }

  static _showRegisterSuccess(msg) {
    const el = document.getElementById('registerSuccess');
    el.textContent = msg;
    el.classList.add('visible');
  }

  static _clearErrors() {
    ['loginError', 'registerError', 'registerSuccess'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('visible');
    });
  }

  static _clearInputs() {
    ['loginUser', 'loginPass'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  static _launchApp() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appShell').style.display = 'block';
    UI.buildNav(this.currentRole);
    UI.updateSessionBar(this.currentRole, this.currentUser);
    if (this.currentRole === 'admin') {
      AdminPanel.init();
    } else {
      UserPanel.init(this.currentUser);
    }
  }
}


class UI {
  static showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const pg = document.getElementById('page-' + id);
    if (pg) pg.classList.add('active');
    const tb = document.querySelector(`[data-page="${id}"]`);
    if (tb) tb.classList.add('active');
  }

  static buildNav(role) {
    const container = document.getElementById('navTabs');
    container.innerHTML = '';
    const tabs = role === 'admin'
      ? [
          { label: 'Usuarios',   page: 'admin-usuarios' },
          { label: 'Historial',  page: 'admin-historial' },
          { label: 'Seguridad',  page: 'admin-seguridad' },
        ]
      : [
          { label: 'Mi cuenta', page: 'user-cuenta' },
          { label: 'Nueva TX',  page: 'user-transaccion' },
        ];

    tabs.forEach((t, i) => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn' + (i === 0 ? ' active' : '');
      btn.textContent = t.label;
      btn.dataset.page = t.page;
      btn.onclick = () => UI.showPage(t.page);
      container.appendChild(btn);
    });

    this.showPage(tabs[0].page);
  }

  static updateSessionBar(role, user) {
    const avatarEl = document.getElementById('sessionAvatar');
    const nameEl = document.getElementById('sessionName');
    const roleEl = document.getElementById('sessionRole');
    const COLORS = ['#2d6a4f','#1d3557','#7b2d8b','#c05621','#1a535c','#3d405b'];

    if (role === 'admin') {
      avatarEl.textContent = 'A';
      avatarEl.style.background = '#3A1C8A';
      nameEl.textContent = 'Administrador';
      roleEl.textContent = 'Admin';
      roleEl.className = 'session-role role-tag-admin';
    } else {
      avatarEl.textContent = store.getInitials(user.name);
      avatarEl.style.background = store.avatarColor(user.id);
      nameEl.textContent = user.name;
      roleEl.textContent = 'Usuario';
      roleEl.className = 'session-role role-tag-user';
    }
  }

  static async renderUsersGrid() {
    const grid = document.getElementById('usersGrid');
    const cnt = document.getElementById('userCount');
    if (!grid) return;

    await store.loadUsers();
    cnt.textContent = store.users.length ? `(${store.users.length})` : '';

    if (!store.users.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">👤</div>Sin usuarios registrados</div>';
      return;
    }

    grid.innerHTML = store.users.map(u => `
      <div class="user-card">
        <div class="user-card-top">
          <div class="avatar" style="background:${store.avatarColor(u.id)}">${store.getInitials(u.name)}</div>
          <div>
            <div class="user-name">${SecurityUtils.sanitize(u.name)}</div>
            <div class="user-id">${u.id} · ${SecurityUtils.sanitize(u.username)}</div>
          </div>
        </div>
        <div class="user-balance">$${parseFloat(u.balance).toFixed(2)}</div>
        ${u.locked ? '<div style="font-size:.72rem;color:var(--red);font-weight:600">⛔ BLOQUEADO</div>' : ''}
        <div class="user-actions">
          <button class="btn btn-outline btn-sm" onclick='AdminPanel.openEdit(${u.id})'>✏ Editar</button>
          <button class="btn btn-red btn-sm" onclick='AdminPanel.deleteUser(${u.id})'>✕</button>
          ${u.locked ? `<button class="btn btn-green btn-sm" onclick='AdminPanel.unlockUser(${u.id})'>🔓</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  static renderTxTable(transactions, bodyId, showUser = true) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    if (!transactions.length) {
      const cols = showUser ? 7 : 6;
      body.innerHTML = `<tr><td colspan="${cols}"><div class="empty"><div class="empty-icon">📋</div>Sin transacciones</div></td></tr>`;
      return;
    }

    body.innerHTML = transactions.map(tx => {
      const isDebit = tx.type !== 'deposit';
      return `
        <tr>
          <td class="mono" style="color:var(--muted);font-size:.72rem">${tx.id}</td>
          ${showUser ? `<td>${SecurityUtils.sanitize(tx.user_name)}${tx.dest_name ? ' → ' + SecurityUtils.sanitize(tx.dest_name) : ''}</td>` : ''}
          <td><span class="badge ${Transaction.BADGES[tx.type]}">${Transaction.LABELS[tx.type]}</span></td>
          <td class="mono ${isDebit ? 'amount-neg' : 'amount-pos'}">${isDebit ? '−' : '+'}$${parseFloat(tx.amount).toFixed(2)}</td>
          <td class="mono" style="color:var(--muted)">$${parseFloat(tx.commission).toFixed(2)}</td>
          <td><span class="badge b-ok">OK</span></td>
          <td style="color:var(--muted);font-size:.78rem">${new Date(tx.timestamp).toLocaleTimeString('es')}</td>
        </tr>
      `;
    }).join('');
  }

  static renderStats() {
    const ok = store.transactions;
    const el = id => document.getElementById(id);
    if (el('sTotal')) el('sTotal').textContent = ok.length;
    if (el('sVolume')) el('sVolume').textContent = '$' + ok.reduce((s,t)=>s+parseFloat(t.amount),0).toFixed(2);
  }

  static toast(msg, type = 'info') {
    const w = document.getElementById('toastWrap');
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    const icons = { ok:'✓', err:'✗', info:'ℹ' };
    t.innerHTML = `<span>${icons[type]||'ℹ'}</span><span>${msg}</span>`;
    w.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  static async renderAuditLog() {
    const el = document.getElementById('auditLog');
    if (!el) return;
    
    await store.loadAuditLog();
    
    if (!store.auditLog.length) {
      el.innerHTML = '<div style="color:var(--muted)">Sin eventos registrados</div>';
      return;
    }

    const colorMap = { info: 'var(--blue)', ok: 'var(--green)', err: 'var(--red)', warn: 'var(--amber)' };
    el.innerHTML = store.auditLog.slice(0, 60).map(e => `
      <div style="display:flex;gap:10px;border-bottom:1px solid var(--line);padding:4px 0;">
        <span style="color:var(--muted);flex-shrink:0">${new Date(e.timestamp).toLocaleTimeString('es',{hour12:false})}</span>
        <span style="color:${colorMap[e.level]||'var(--ink2)'};flex-shrink:0;font-weight:600">[${e.actor}]</span>
        <span style="color:var(--ink2)">${e.action}</span>
        <span style="color:var(--muted);margin-left:auto;text-align:right;font-size:.7rem">${e.detail}</span>
      </div>
    `).join('');
  }
}



class AdminPanel {
  static async init() {
    await UI.renderUsersGrid();
    await store.loadTransactions();
    UI.renderTxTable(store.transactions, 'txBody', true);
    UI.renderStats();
    await UI.renderAuditLog();
  }

  static openEdit(id) {
    const u = store.getUserById(id);
    if (!u) return;
    document.getElementById('editId').value = id;
    document.getElementById('editName').value = u.name;
    document.getElementById('editBalance').value = u.balance;
    document.getElementById('editPassword').value = '';
    document.getElementById('editModal').classList.add('open');
    setTimeout(() => document.getElementById('editName').focus(), 80);
  }

  static async saveEdit() {
    const id = parseInt(document.getElementById('editId').value);
    const name = document.getElementById('editName').value.trim();
    const balance = parseFloat(document.getElementById('editBalance').value);
    const newPass = document.getElementById('editPassword').value;

    if (!name) return UI.toast('Nombre requerido.', 'err');
    if (isNaN(balance) || balance < 0) return UI.toast('Saldo inválido.', 'err');
    if (newPass && !SecurityUtils.isValidPassword(newPass))
      return UI.toast('Contraseña mínimo 6 caracteres.', 'err');

    try {
      await API.updateUser(id, name, balance, newPass || null);
      await UI.renderUsersGrid();
      closeModal();
      UI.toast('Usuario actualizado.', 'ok');
    } catch (error) {
      UI.toast(error.message, 'err');
    }
  }

  static async deleteUser(id) {
    const u = store.getUserById(id);
    if (!u || !confirm(`¿Eliminar a ${u.name}?`)) return;
    
    try {
      await API.deleteUser(id);
      await UI.renderUsersGrid();
      UI.toast('Usuario eliminado.', 'info');
    } catch (error) {
      UI.toast(error.message, 'err');
    }
  }

  static async unlockUser(id) {
    const u = store.getUserById(id);
    if (!u) return;
    
    try {
      await API.unlockUser(id);
      await UI.renderUsersGrid();
      UI.toast(`${u.name} desbloqueado.`, 'ok');
    } catch (error) {
      UI.toast(error.message, 'err');
    }
  }

  static async clearHistory() {
    if (!store.transactions.length) return;
    if (!confirm('¿Limpiar todo el historial?')) return;
    
    try {
      await API.clearHistory();
      store.transactions = [];
      UI.renderTxTable([], 'txBody', true);
      UI.renderStats();
      UI.toast('Historial limpiado.', 'info');
    } catch (error) {
      UI.toast(error.message, 'err');
    }
  }

  static async exportJSON() {
    if (!store.transactions.length) return UI.toast('No hay transacciones para exportar.', 'err');
    
    const ok = store.transactions;
    const payload = {
      exportado_en: new Date().toISOString(),
      resumen: {
        total: ok.length,
        volumen_total: parseFloat(ok.reduce((s,t)=>s+parseFloat(t.amount),0).toFixed(2)),
        comisiones: parseFloat(ok.reduce((s,t)=>s+parseFloat(t.commission),0).toFixed(2)),
      },
      usuarios: store.users.map(u => ({
        id: u.id, nombre: u.name, username: u.username, saldo: u.balance,
      })),
      transacciones: ok.map(tx => ({
        id: tx.id,
        usuario_id: tx.user_id,
        usuario: tx.user_name,
        destino: tx.dest_name,
        tipo: tx.type,
        monto: tx.amount,
        comision: tx.commission,
        descripcion: tx.description,
        estado: tx.status,
        timestamp: tx.timestamp,
      })),
    };
    
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transacciones_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    UI.toast(`Exportado: ${ok.length} transacciones.`, 'ok');
  }
}



class UserPanel {
  static currentUser = null;

  static async init(user) {
    this.currentUser = user;
    await this._populateDestDropdown();
    this.toggleDest();
    await this._refreshAccount();
  }

  static async _refreshAccount() {
    const u = this.currentUser;
    await store.loadUsers(); // Refresh balance
    const updatedUser = store.getUserById(u.id);
    if (updatedUser) this.currentUser = updatedUser;

    const el = id => document.getElementById(id);
    if (el('myBalanceAmount')) el('myBalanceAmount').textContent = '$' + parseFloat(this.currentUser.balance).toFixed(2);
    if (el('myBalanceId')) el('myBalanceId').textContent = this.currentUser.id + ' · ' + this.currentUser.username;

    await store.loadTransactions(u.id);
    UI.renderTxTable(store.transactions, 'myTxBody', false);
  }

  static async _populateDestDropdown() {
    await store.loadUsers();
    const sel = document.getElementById('txDest');
    while (sel.options.length > 1) sel.remove(1);
    store.users
      .filter(u => u.id !== this.currentUser.id)
      .forEach(u => {
        const o = document.createElement('option');
        o.value = u.id;
        o.textContent = u.name;
        sel.appendChild(o);
      });
  }

  static toggleDest() {
    const type = document.getElementById('txType').value;
    const field = document.getElementById('destField');
    if (field) field.style.visibility = type === 'transfer' ? 'visible' : 'hidden';
  }

  static previewTx() {
    const type = document.getElementById('txType').value;
    const amount = parseFloat(document.getElementById('txAmount').value);
    const prev = document.getElementById('txPreview');
    
    if (!amount || isNaN(amount) || amount <= 0) {
      prev.classList.remove('visible');
      return;
    }

    const rate = Transaction.RATES[type] || 0;
    const commission = Transaction.calcCommission(amount, type);
    const total = Transaction.calcTotal(amount, type);

    document.getElementById('prevAmount').textContent = '$' + amount.toFixed(2);
    document.getElementById('prevComm').textContent = '$' + commission.toFixed(2) + ' (' + (rate*100).toFixed(1) + '%)';

    if (type === 'deposit') {
      document.getElementById('prevTotal').textContent = '+$' + amount.toFixed(2);
      document.getElementById('prevTotal').style.color = 'var(--green)';
    } else {
      document.getElementById('prevTotal').textContent = '$' + total.toFixed(2);
      document.getElementById('prevTotal').style.color = 'var(--ink)';
    }
    
    prev.classList.add('visible');
  }

  static async processTransaction() {
    const user = this.currentUser;
    const type = document.getElementById('txType').value;
    const amount = parseFloat(document.getElementById('txAmount').value);
    const destId = parseInt(document.getElementById('txDest').value) || null;
    const desc = document.getElementById('txDesc').value.trim();

    if (!amount || isNaN(amount) || amount <= 0)
      return UI.toast('Ingresa un monto válido.', 'err');
    if (amount > 500000)
      return UI.toast('Monto excede el límite ($500,000).', 'err');
    if (type === 'transfer' && (!destId || destId === user.id))
      return UI.toast('Selecciona un usuario destino distinto.', 'err');

    try {
      await API.createTransaction(user.id, type, amount, destId, desc);
      
      await this._refreshAccount();
      
      // Reset form
      document.getElementById('txAmount').value = '';
      document.getElementById('txDesc').value = '';
      document.getElementById('txPreview').classList.remove('visible');
      
      UI.toast('✓ Transacción procesada correctamente.', 'ok');
    } catch (error) {
      UI.toast(error.message, 'err');
    }
  }
}



function closeModal(e) {
  if (e && e.target !== document.getElementById('editModal')) return;
  document.getElementById('editModal').classList.remove('open');
}