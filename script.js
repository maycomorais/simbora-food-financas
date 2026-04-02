/* ============================================================
   SIMBORA FOOD PARK — script.js v1.1
   Módulos: Config → ExchangeAPI → DriveUpload → OfflineQueue
            → DB → Calc → Auth → UIAuth → UIToast →
            UIConnStatus → UILoading → UIHeader → UIList →
            UIDashboard → UIFuturas → UIRecorrencias →
            Modal → FormHandler → App → PWAInstall
   ============================================================ */

'use strict';

// ============================================================
// CONFIG — preencha com suas credenciais
// ============================================================
const Config = {
  SB_URL:            'https://qwbpbpkzhfjvdxmszhxb.supabase.co',
  SB_KEY:            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3YnBicGt6aGZqdmR4bXN6aHhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNDIyMjIsImV4cCI6MjA4OTYxODIyMn0.uY3uEJi5YFuDbcWqasML___hIvazM3bfdXB8vtgc7bE',

  // Google Apps Script Web App URL (veja SETUP.md → Passo 2)
  DRIVE_UPLOAD_URL:  'https://script.google.com/macros/s/AKfycbzDovUM3BIhsFGPtEn59ADjibGj-ozHgUpb46vFzGZ89U9VpGnp0i3HUASapxGQfjfZ/exec',

  // Limite de tamanho de arquivo (10 MB)
  MAX_FILE_SIZE_MB:  10,

  EXCHANGE_URL:      'https://economia.awesomeapi.com.br/last/BRL-PYG,USD-PYG,USD-BRL',
  FALLBACK_RATES:    { BRL_PYG: 1420, USD_PYG: 7800, USD_BRL: 5.50 },
  OFFLINE_KEY:       'sfp_offline_v1',
  CHART_COLORS: [
    '#f59e0b','#ef4444','#10b981','#3b82f6','#8b5cf6',
    '#f97316','#ec4899','#14b8a6','#84cc16','#06b6d4',
    '#6366f1','#d97706','#22c55e','#e879f9','#fb923c',
  ],
};

const _sb = supabase.createClient(Config.SB_URL, Config.SB_KEY);

// ============================================================
// FORMATTERS
// ============================================================
const fmt = {
  pyg:   v => `₲ ${Math.abs(+v || 0).toLocaleString('es-PY',   { maximumFractionDigits: 0 })}`,
  brl:   v => `R$ ${Math.abs(+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  usd:   v => `$ ${Math.abs(+v || 0).toLocaleString('en-US',  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  money: (v, moeda) => moeda === 'BRL' ? fmt.brl(v) : moeda === 'USD' ? fmt.usd(v) : fmt.pyg(v),
  date:  d => d ? d.split('-').reverse().join('/') : '—',
  pct:   (v, t) => t > 0 ? ((Math.abs(+v) / t) * 100).toFixed(1) + '%' : '0%',
  signed: (v, fn) => (v < 0 ? '−' : '') + fn(Math.abs(v)),
};

// ============================================================
// STATE
// ============================================================
const State = {
  user:           null,
  profile:        null,
  transactions:   [],
  futureRevenues: [],
  recurring:      [],
  fontes:         [],
  categorias:     [],
  exchangeRates:  { ...Config.FALLBACK_RATES },
  currentMonth:   '',
  filterTipo:     'TUDO',
  filterFutura:   'TUDO',
  searchQuery:    '',
  dashMoeda:      'PYG',
  charts:         {},
  isOnline:       navigator.onLine,
  currentView:    'dashboard',
  _uploadResult:  null,
  _editMode:      null, // 'tx' | 'futura' | 'recorrencia'
};

// ============================================================
// EXCHANGE API
// ============================================================
const ExchangeAPI = {
  async fetch() {
    try {
      const res  = await fetch(Config.EXCHANGE_URL);
      const data = await res.json();
      if (data?.BRLPYG?.bid) State.exchangeRates.BRL_PYG = parseFloat(data.BRLPYG.bid);
      if (data?.USDPYG?.bid) State.exchangeRates.USD_PYG = parseFloat(data.USDPYG.bid);
      if (data?.USDBRL?.bid) State.exchangeRates.USD_BRL = parseFloat(data.USDBRL.bid);
    } catch (_) {
      console.warn('[ExchangeAPI] usando fallback');
    }
    this._updateBadge();
  },

  toPYG(valor, moeda) {
    const v = +valor || 0;
    if (moeda === 'PYG') return v;
    if (moeda === 'BRL') return v * State.exchangeRates.BRL_PYG;
    if (moeda === 'USD') return v * State.exchangeRates.USD_PYG;
    return v;
  },

  _updateBadge() {
    const el1 = document.getElementById('rate-brl-pyg');
    const el2 = document.getElementById('rate-usd-pyg');
    if (el1) el1.textContent = `R$1 = ₲${State.exchangeRates.BRL_PYG.toFixed(0)}`;
    if (el2) el2.textContent = `$1 = ₲${State.exchangeRates.USD_PYG.toFixed(0)}`;
  },
};

// ============================================================
// GOOGLE DRIVE UPLOAD
// Usa Google Apps Script como Web App intermediário.
// O arquivo é lido como base64 no browser e enviado via fetch.
// O Apps Script salva no Drive e devolve o link público.
// ============================================================
const DriveUpload = {
  async upload(file, onProgress) {
    if (!Config.DRIVE_UPLOAD_URL || Config.DRIVE_UPLOAD_URL.includes('SEU_SCRIPT_ID')) {
      UIToast.show('⚠️ Configure DRIVE_UPLOAD_URL no Config (veja SETUP.md)', 'warning');
      return null;
    }

    const maxBytes = Config.MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      UIToast.show(`⚠️ Arquivo muito grande (máx. ${Config.MAX_FILE_SIZE_MB} MB)`, 'warning');
      return null;
    }

    // 1. Ler o arquivo como base64 (progresso simulado: 0→50%)
    if (onProgress) onProgress(10);
    const base64 = await this._toBase64(file);
    if (onProgress) onProgress(40);

    // 2. Enviar para o Apps Script
    // IMPORTANTE: sem Content-Type explícito → browser usa text/plain → sem CORS preflight.
    // Com application/json o browser dispara OPTIONS primeiro; o Apps Script ignora e o
    // fetch falha com "Failed to fetch". redirect:'follow' trata o redirect para
    // script.googleusercontent.com que o Apps Script faz automaticamente.
    const controller = new AbortController();
    const _timeout   = setTimeout(() => controller.abort(), 30000);

    let res;
    try {
      res = await fetch(Config.DRIVE_UPLOAD_URL, {
        method:   'POST',
        redirect: 'follow',
        signal:   controller.signal,
        body: JSON.stringify({
          data:     base64,
          mimeType: file.type || 'application/octet-stream',
          fileName: file.name,
        }),
      });
    } catch (fetchErr) {
      clearTimeout(_timeout);
      if (fetchErr.name === 'AbortError')
        throw new Error('Timeout: servidor demorou mais de 30s para responder');
      throw new Error('Falha de conexão com o servidor de upload. Verifique sua internet.');
    }
    clearTimeout(_timeout);

    if (onProgress) onProgress(90);

    if (!res.ok) throw new Error(`Erro HTTP ${res.status} — verifique o deploy do Apps Script`);

    let json;
    try { json = await res.json(); }
    catch { throw new Error('Resposta inválida do Apps Script (não é JSON)'); }
    if (!json.ok) throw new Error(json.error || 'Erro desconhecido no Apps Script');

    if (onProgress) onProgress(100);

    return {
      url:          json.url,           // link "view" do Drive
      downloadUrl:  json.downloadUrl,   // link de download direto
      embedUrl:     json.embedUrl,      // link para embed (preview)
      public_id:    json.id,            // ID do arquivo no Drive
      tipo:         json.tipo,          // 'image' | 'pdf'
      nome:         json.nome,          // nome original do arquivo
    };
  },

  // Converte File → base64 puro (sem o prefixo data:...)
  _toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Erro ao ler o arquivo'));
      reader.readAsDataURL(file);
    });
  },
};

// ============================================================
// OFFLINE QUEUE
// ============================================================
const OfflineQueue = {
  _k: Config.OFFLINE_KEY,
  load()       { try { return JSON.parse(localStorage.getItem(this._k) || '[]'); } catch { return []; } },
  save(q)      { localStorage.setItem(this._k, JSON.stringify(q)); this._banner(); },
  count()      { return this.load().length; },

  enqueue(action, table, payload) {
    const q = this.load();
    q.push({ _id: crypto.randomUUID(), _at: new Date().toISOString(), action, table, payload });
    this.save(q);
    UIToast.show('📶 Sem conexão — operação salva localmente', 'warning');
  },

  _banner() {
    const n  = this.count();
    const el = document.getElementById('offline-banner');
    if (!el) return;
    el.style.display = n > 0 ? 'flex' : 'none';
    const t = document.getElementById('offline-banner-text');
    if (t) t.textContent = `${n} operação(ões) aguardando sincronização — toque para sincronizar`;
  },

  async drain() {
    const q = this.load();
    if (!q.length) return;
    UIToast.show(`📶 Sincronizando ${q.length} item(s)…`, 'info');
    const failed = [];
    for (const item of q) {
      let err = null;
      try {
        if (item.action === 'insert')
          ({ error: err } = await _sb.from(item.table).insert(item.payload));
        else if (item.action === 'update')
          ({ error: err } = await _sb.from(item.table).update(item.payload.data).eq('id', item.payload.id));
        else if (item.action === 'delete')
          ({ error: err } = await _sb.from(item.table).delete().eq('id', item.payload.id));
      } catch (e) { err = e; }
      if (err) { console.error('[Queue]', item._id, err); failed.push(item); }
    }
    this.save(failed);
    if (!failed.length) { UIToast.show('✅ Sincronização completa!', 'success'); app.fetchData(); }
    else UIToast.show(`⚠️ ${failed.length} item(s) não sincronizado(s)`, 'danger');
  },

  init() {
    this._banner();
    window.addEventListener('online',  async () => { State.isOnline = true;  UIConnStatus.update(true);  await this.drain(); });
    window.addEventListener('offline', ()       => { State.isOnline = false; UIConnStatus.update(false); });
  },
};

// ============================================================
// DB — Supabase + offline fallback
// ============================================================
const DB = {
  async fetchTransactions(year, month) {
    if (!State.isOnline) { UIToast.show('Offline — sem novos dados', 'warning'); return []; }
    const lastDay = new Date(+year, +month, 0).getDate();
    const { data, error } = await _sb.from('transacoes')
      .select('*, fontes_receita(nome,icone,cor), categorias_despesa(nome,icone,cor), profiles!criado_por(nome)')
      .gte('data', `${year}-${month}-01`)
      .lte('data', `${year}-${month}-${String(lastDay).padStart(2, '0')}`)
      .order('data', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) { UIToast.show('Erro ao buscar: ' + error.message, 'danger'); return []; }
    return data || [];
  },

  async fetchFutureRevenues(year, month) {
    if (!State.isOnline) return [];
    // Busca do mês atual em diante (próximos 4 meses)
    const dateFrom = `${year}-${month}-01`;
    const endDate  = new Date(+year, +month + 2, 0);
    const dateTo   = endDate.toISOString().split('T')[0];
    const { data, error } = await _sb.from('receitas_futuras')
      .select('*, fontes_receita(nome,icone,cor)')
      .gte('data_prevista', dateFrom)
      .lte('data_prevista', dateTo)
      .not('status', 'eq', 'REALIZADO')
      .order('data_prevista');
    if (error) { console.error('[DB.futuras]', error); return []; }
    return data || [];
  },

  async fetchRecurring() {
    if (!State.isOnline) return [];
    const { data, error } = await _sb.from('despesas_recorrentes')
      .select('*, categorias_despesa(nome,icone,cor)')
      .order('dia_vencimento');
    if (error) { console.error('[DB.recurring]', error); return []; }
    return data || [];
  },

  async fetchFontes() {
    const { data } = await _sb.from('fontes_receita').select('*').eq('ativa', true).order('ordem');
    return data || [];
  },

  async fetchCategorias() {
    const { data } = await _sb.from('categorias_despesa').select('*').eq('ativa', true).order('ordem');
    return data || [];
  },

  async insert(table, payload) {
    payload.criado_por = State.user?.id;
    if (!State.isOnline) { OfflineQueue.enqueue('insert', table, payload); return null; }
    const { error } = await _sb.from(table).insert([payload]);
    return error;
  },

  async insertMany(table, payloads) {
    payloads = payloads.map(p => ({ ...p, criado_por: State.user?.id }));
    if (!State.isOnline) { OfflineQueue.enqueue('insert', table, payloads); return null; }
    const { error } = await _sb.from(table).insert(payloads);
    return error;
  },

  async update(table, id, payload) {
    if (!State.isOnline) { OfflineQueue.enqueue('update', table, { id, data: payload }); return null; }
    const { error } = await _sb.from(table).update(payload).eq('id', id);
    return error;
  },

  async delete(table, id) {
    if (!State.isOnline) { OfflineQueue.enqueue('delete', table, { id }); return null; }
    const { error } = await _sb.from(table).delete().eq('id', id);
    return error;
  },
};

// ============================================================
// CALC
// ============================================================
const Calc = {
  toPYG:          (v, m) => ExchangeAPI.toPYG(v, m),
  totalReceitas:  txs => txs.filter(t => t.tipo === 'RECEITA'  && t.status === 'CONCLUIDO').reduce((a, t) => a + Calc.toPYG(t.valor, t.moeda), 0),
  totalDespesas:  txs => txs.filter(t => t.tipo === 'DESPESA'  && t.status === 'CONCLUIDO').reduce((a, t) => a + Calc.toPYG(t.valor, t.moeda), 0),
  resultado:      txs => Calc.totalReceitas(txs) - Calc.totalDespesas(txs),

  porFonte(txs) {
    const map = {};
    txs.filter(t => t.tipo === 'RECEITA' && t.status === 'CONCLUIDO').forEach(t => {
      const k = t.fontes_receita?.nome || 'Outros';
      map[k] = (map[k] || 0) + this.toPYG(t.valor, t.moeda);
    });
    return map;
  },

  porCategoria(txs) {
    const map = {};
    txs.filter(t => t.tipo === 'DESPESA' && t.status === 'CONCLUIDO').forEach(t => {
      const k = t.categorias_despesa?.nome || 'Outros';
      map[k] = (map[k] || 0) + this.toPYG(t.valor, t.moeda);
    });
    return map;
  },

  concilStats(txs) {
    const r = txs.filter(t => t.tipo !== 'TRANSFERENCIA');
    return { total: r.length, concil: r.filter(t => t.conciliado).length, pending: r.filter(t => !t.conciliado).length };
  },
};

// ============================================================
// AUTH
// ============================================================
const Auth = {
  async init() {
    const { data: { session } } = await _sb.auth.getSession();
    if (session?.user) { await this._loadProfile(session.user); return true; }
    return false;
  },

  async login(email, password) {
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await this._loadProfile(data.user);
    return data.user;
  },

  async logout() {
    await _sb.auth.signOut();
    State.user = null; State.profile = null;
    UIAuth.showLogin();
  },

  async _loadProfile(user) {
    State.user = user;
    const { data } = await _sb.from('profiles').select('*').eq('id', user.id).single();
    State.profile = data;
  },

  isSocio() { return ['socio', 'admin'].includes(State.profile?.role); },
};

// ============================================================
// UI — Auth screen
// ============================================================
const UIAuth = {
  showLogin() {
    document.getElementById('auth-screen').style.display = '';
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('auth-error').style.display = 'none';
    document.getElementById('login-email').value = '';
    document.getElementById('login-pass').value  = '';
  },

  showApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-shell').classList.remove('hidden');
    // Update user avatar / name
    const name  = State.profile?.nome || State.user?.email || '?';
    const role  = State.profile?.role || 'viewer';
    const init  = name.charAt(0).toUpperCase();
    const el    = document.getElementById('user-avatar');
    if (el) el.textContent = init;
    const nm = document.getElementById('user-dropdown-name');
    const rl = document.getElementById('user-dropdown-role');
    if (nm) nm.textContent = name;
    if (rl) rl.textContent = role === 'admin' ? '👑 Admin' : role === 'socio' ? '🤝 Sócio' : '👁 Visualizador';
  },

  togglePass() {
    const inp = document.getElementById('login-pass');
    const ico = document.getElementById('auth-eye');
    if (inp.type === 'password') { inp.type = 'text'; if (ico) ico.textContent = 'visibility_off'; }
    else { inp.type = 'password'; if (ico) ico.textContent = 'visibility'; }
  },

  setup() {
    document.getElementById('login-form').onsubmit = async e => {
      e.preventDefault();
      const btn = document.getElementById('auth-submit');
      btn.disabled  = true;
      btn.innerHTML = '<span class="material-symbols-rounded spin">progress_activity</span> Entrando…';
      const errEl = document.getElementById('auth-error');
      errEl.style.display = 'none';
      try {
        await Auth.login(
          document.getElementById('login-email').value,
          document.getElementById('login-pass').value
        );
        UIAuth.showApp();
        app.bootstrap();
      } catch (err) {
        errEl.textContent  = 'E-mail ou senha incorretos.';
        errEl.style.display = 'block';
      } finally {
        btn.disabled  = false;
        btn.innerHTML = '<span class="material-symbols-rounded">login</span> Entrar';
      }
    };
  },
};

// ============================================================
// UI — Toast
// ============================================================
const UIToast = {
  _el: null,
  init() { this._el = document.getElementById('toast-container'); },
  show(msg, type = 'info', ms = 3500) {
    if (!this._el) return;
    const el = document.createElement('div');
    el.className   = `toast toast--${type}`;
    el.textContent = msg;
    this._el.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast--visible'));
    setTimeout(() => { el.classList.remove('toast--visible'); setTimeout(() => el.remove(), 400); }, ms);
  },
};

// ============================================================
// UI — Connection dot
// ============================================================
const UIConnStatus = {
  update(online) {
    const el = document.getElementById('conn-dot');
    if (el) { el.className = `conn-dot conn-dot--${online ? 'online' : 'offline'}`; el.title = online ? 'Online' : 'Offline'; }
  },
};

// ============================================================
// UI — Loading skeleton
// ============================================================
const UILoading = {
  show(containerId = 'tx-list') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `<div class="skeleton-list">${Array.from({ length: 4 }, () => `
      <div class="skel-card">
        <div class="skel skel--icon"></div>
        <div style="flex:1">
          <div class="skel skel--title"></div>
          <div class="skel skel--sub"></div>
        </div>
        <div class="skel skel--val"></div>
      </div>`).join('')}</div>`;
  },
};

// ============================================================
// UI — Header KPIs
// ============================================================
const UIHeader = {
  update(txs) {
    const rec = Calc.totalReceitas(txs);
    const dep = Calc.totalDespesas(txs);
    const res = rec - dep;

    this._anim('kpi-receitas', fmt.pyg(rec));
    this._anim('kpi-despesas', fmt.pyg(dep));
    this._anim('kpi-resultado', fmt.signed(res, fmt.pyg));

    const resEl = document.getElementById('kpi-resultado');
    if (resEl) resEl.style.color = res >= 0 ? 'var(--success)' : 'var(--danger)';

    // Subtitle: % of revenue
    const dep_pct = rec > 0 ? ((dep / rec) * 100).toFixed(0) : 0;
    const sub_dep = document.getElementById('kpi-despesas-sub');
    if (sub_dep) sub_dep.textContent = rec > 0 ? `${dep_pct}% das receitas` : '';
    const sub_res = document.getElementById('kpi-resultado-sub');
    if (sub_res) sub_res.textContent = res >= 0 ? 'Superávit' : 'Déficit';
  },

  _anim(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.cssText = 'opacity:.3;transform:translateY(4px);transition:opacity .2s,transform .2s';
    requestAnimationFrame(() => { el.textContent = value; el.style.cssText = 'opacity:1;transform:translateY(0);transition:opacity .2s,transform .2s'; });
  },
};

// ============================================================
// UI — Transaction List
// ============================================================
const UIList = {
  render(txs) {
    const el = document.getElementById('tx-list');
    if (!el) return;
    if (!txs.length) {
      el.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded">receipt_long</span><p>Nenhuma movimentação encontrada</p></div>`;
      return;
    }
    el.innerHTML = txs.map(t => this._item(t)).join('');
  },

  _item(t) {
    const isRec  = t.tipo === 'RECEITA';
    const isTr   = t.tipo === 'TRANSFERENCIA';
    const icon   = t.fontes_receita?.icone || t.categorias_despesa?.icone || (isTr ? '⇄' : isRec ? '↑' : '↓');
    const cls    = isRec ? 'receita' : isTr ? 'transfer' : 'despesa';
    const valCls = isRec ? 'receita' : 'despesa';
    const sign   = isRec ? '+' : '−';

    const sub = [
      t.fontes_receita?.nome || t.categorias_despesa?.nome,
      t.fornecedor,
      t.metodo_pagamento,
      t.descricao,
    ].filter(Boolean).join(' · ');

    const badges = [
      t.status === 'PENDENTE'  ? `<span class="badge badge--pendente">⏳ Pendente</span>` : '',
      t.status === 'CANCELADO' ? `<span class="badge badge--cancelado">✕ Cancelado</span>` : '',
      t.conciliado             ? `<span class="badge badge--conciliado">✓ Concil.</span>` : '',
      t.total_parcelas > 1     ? `<span class="badge badge--parcela">${t.parcela_atual}/${t.total_parcelas}</span>` : '',
      t.valor_iva > 0          ? `<span class="badge badge--iva">IVA: ${fmt.pyg(t.valor_iva)}</span>` : '',
    ].filter(Boolean).join('');

    const comprovante = t.comprovante_url
      ? `<a href="${t.comprovante_url}" target="_blank" class="btn-comprovante" title="Ver ${t.comprovante_tipo === 'pdf' ? 'PDF' : 'foto'}">
           <span class="material-symbols-rounded">${t.comprovante_tipo === 'pdf' ? 'picture_as_pdf' : 'image'}</span>
         </a>` : '';

    const canEdit = Auth.isSocio();
    const editBtn = canEdit
      ? `<button class="btn-edit-icon" onclick="app.editTx('${t.id}')" title="Editar">
           <span class="material-symbols-rounded">edit</span>
         </button>` : '';

    return `
    <div class="tx-item ${t.conciliado ? 'tx-item--conciliado' : ''}">
      <div class="tx-icon tx-icon--${cls}">${icon}</div>
      <div class="tx-info">
        <div class="tx-title">${this._esc(t.fontes_receita?.nome || t.categorias_despesa?.nome || t.descricao || '—')}</div>
        <div class="tx-sub">${this._esc(sub)}</div>
        ${badges ? `<div class="tx-badges">${badges}</div>` : ''}
        ${t.observacoes ? `<div class="tx-sub" style="font-style:italic;color:var(--text-3)">"${this._esc(t.observacoes)}"</div>` : ''}
      </div>
      <div class="tx-right">
        <div class="tx-valor tx-valor--${valCls}">${sign} ${fmt.money(t.valor, t.moeda)}</div>
        <div class="tx-date">${fmt.date(t.data)}</div>
        <div class="tx-actions">${comprovante}${editBtn}</div>
      </div>
    </div>`;
  },

  _esc: s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
};

// ============================================================
// UI — Dashboard
// ============================================================
const UIDashboard = {
  update(txs, futuras) {
    // Concil stats
    const stats = Calc.concilStats(txs);
    const concEl = document.getElementById('dash-concil');
    if (concEl) {
      if (stats.total > 0) {
        const pct = Math.round((stats.concil / stats.total) * 100);
        concEl.style.display = 'flex';
        concEl.innerHTML = `
          <div class="concil-bar" style="flex:1">
            <div class="concil-fill" style="width:${pct}%"></div>
          </div>
          <span class="concil-text">
            ${stats.concil}/${stats.total} conciliados (${pct}%)
            ${stats.pending > 0 ? `— <span style="color:var(--warning)">${stats.pending} pendente(s)</span>` : ''}
          </span>`;
      } else { concEl.style.display = 'none'; }
    }

    // Charts
    this._chartFontes(Calc.porFonte(txs));
    this._chartCategorias(Calc.porCategoria(txs));

    // Upcoming revenues (próximas 5)
    this._renderUpcoming(futuras);

    // Recent transactions (last 6)
    this._renderRecent(txs.slice(0, 6));
  },

  _chartFontes(map) {
    const el = document.getElementById('chartFontes');
    if (!el) return;
    const labels = Object.keys(map);
    const data   = Object.values(map);
    const total  = data.reduce((a, b) => a + b, 0);
    if (State.charts.fontes) State.charts.fontes.destroy();

    if (!labels.length) { document.getElementById('legend-fontes').innerHTML = '<div style="color:var(--text-3);font-size:.8rem;text-align:center;padding:10px;">Sem dados</div>'; return; }

    State.charts.fontes = new Chart(el.getContext('2d'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: Config.CHART_COLORS, borderWidth: 2, borderColor: 'transparent', hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt.pyg(ctx.parsed)}` } } } },
    });

    document.getElementById('legend-fontes').innerHTML = labels
      .map((l, i) => ({ l, v: data[i], c: Config.CHART_COLORS[i % Config.CHART_COLORS.length] }))
      .sort((a, b) => b.v - a.v)
      .map(({ l, v, c }) => `
        <div class="legend-item">
          <div class="legend-left"><div class="legend-dot" style="background:${c}"></div><span>${l}</span></div>
          <div>
            <span class="legend-val">${fmt.pyg(v)}</span>
            <span class="legend-pct"> ${fmt.pct(v, total)}</span>
          </div>
        </div>`).join('');
  },

  _chartCategorias(map) {
    const el = document.getElementById('chartCategorias');
    if (!el) return;
    const labels = Object.keys(map);
    const data   = Object.values(map);
    const total  = data.reduce((a, b) => a + b, 0);
    if (State.charts.categorias) State.charts.categorias.destroy();

    if (!labels.length) { document.getElementById('legend-categorias').innerHTML = '<div style="color:var(--text-3);font-size:.8rem;text-align:center;padding:10px;">Sem dados</div>'; return; }

    State.charts.categorias = new Chart(el.getContext('2d'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: Config.CHART_COLORS, borderWidth: 2, borderColor: 'transparent', hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt.pyg(ctx.parsed)}` } } } },
    });

    document.getElementById('legend-categorias').innerHTML = labels
      .map((l, i) => ({ l, v: data[i], c: Config.CHART_COLORS[i % Config.CHART_COLORS.length] }))
      .sort((a, b) => b.v - a.v)
      .map(({ l, v, c }) => `
        <div class="legend-item">
          <div class="legend-left"><div class="legend-dot" style="background:${c}"></div><span>${l}</span></div>
          <div>
            <span class="legend-val">${fmt.pyg(v)}</span>
            <span class="legend-pct"> ${fmt.pct(v, total)}</span>
          </div>
        </div>`).join('');
  },

  _renderUpcoming(futuras) {
    const card = document.getElementById('upcoming-revenues-card');
    const list = document.getElementById('upcoming-revenues-list');
    if (!card || !list) return;
    const upcoming = futuras.filter(f => f.status !== 'CANCELADO').slice(0, 5);
    if (!upcoming.length) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    list.innerHTML = upcoming.map(f => `
      <div class="futura-item">
        <div class="futura-icon">${f.fontes_receita?.icone || '💰'}</div>
        <div class="futura-info">
          <div class="futura-desc">${UIList._esc(f.descricao)}</div>
          <div class="futura-meta">${f.fontes_receita?.nome || '—'} · ${fmt.date(f.data_prevista)}</div>
        </div>
        <div class="futura-right">
          <div class="futura-valor">${fmt.money(f.valor_esperado, f.moeda)}</div>
          <span class="futura-status status--${f.status}">${f.status}</span>
        </div>
      </div>`).join('');
  },

  _renderRecent(txs) {
    const el = document.getElementById('recent-list');
    if (!el) return;
    if (!txs.length) { el.innerHTML = '<div style="color:var(--text-3);font-size:.82rem;padding:8px;">Nenhuma movimentação no mês</div>'; return; }
    el.innerHTML = txs.map(t => UIList._item(t)).join('');
  },
};

// ============================================================
// UI — Futuras (full view)
// ============================================================
const UIFuturas = {
  render(futuras) {
    const el = document.getElementById('futuras-list');
    if (!el) return;
    const filter = State.filterFutura;
    const list   = filter === 'TUDO' ? futuras : futuras.filter(f => f.status === filter);

    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded">event_upcoming</span><p>Nenhuma receita prevista encontrada</p></div>`;
      return;
    }
    const canEdit = Auth.isSocio();
    el.innerHTML = list.map(f => `
      <div class="futura-card">
        <div class="futura-icon">${f.fontes_receita?.icone || '💰'}</div>
        <div class="futura-info" style="flex:1;min-width:0;">
          <div class="futura-desc">${UIList._esc(f.descricao)}</div>
          <div class="futura-meta">
            ${f.fontes_receita?.nome || '—'} · ${fmt.date(f.data_prevista)}
            ${f.is_recorrente ? ` · 🔄 ${f.frequencia}` : ''}
          </div>
          ${f.observacoes ? `<div class="futura-meta" style="font-style:italic;">"${UIList._esc(f.observacoes)}"</div>` : ''}
          ${canEdit ? `<div class="futura-card-actions">
            ${f.status !== 'REALIZADO' && f.status !== 'CANCELADO' ? `
              <button class="btn-sm btn-sm--success" onclick="app.realizarFutura('${f.id}')">
                <span class="material-symbols-rounded" style="font-size:14px;">check</span> Realizar
              </button>
              <button class="btn-sm btn-sm--danger" onclick="app.cancelarFutura('${f.id}')">
                <span class="material-symbols-rounded" style="font-size:14px;">close</span> Cancelar
              </button>` : ''}
            <button class="btn-sm btn-sm--edit" onclick="app.editFutura('${f.id}')">
              <span class="material-symbols-rounded" style="font-size:14px;">edit</span> Editar
            </button>
          </div>` : ''}
        </div>
        <div class="futura-right">
          <div class="futura-valor">${fmt.money(f.valor_esperado, f.moeda)}</div>
          <span class="futura-status status--${f.status}">${f.status}</span>
        </div>
      </div>`).join('');
  },
};

// ============================================================
// UI — Recorrências
// ============================================================
const UIRecorrencias = {
  render(list) {
    const el = document.getElementById('recorrencias-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded">autorenew</span><p>Nenhuma despesa recorrente configurada</p></div>`;
      return;
    }
    const canEdit = Auth.isSocio();
    el.innerHTML = list.map(r => {
      const icon = r.categorias_despesa?.icone || '📦';
      const cat  = r.categorias_despesa?.nome  || '—';
      const dia  = r.dia_vencimento ? `Vence dia ${r.dia_vencimento}` : 'Sem vencimento';
      const val  = r.valor_estimado ? fmt.money(r.valor_estimado, r.moeda) : 'Valor variável';
      return `
      <div class="rec-card ${r.ativa ? '' : 'rec-card--inactive'}">
        <div class="rec-icon">${icon}</div>
        <div class="rec-info">
          <div class="rec-title">${UIList._esc(r.descricao)}</div>
          <div class="rec-meta">${cat} · ${dia}${r.fornecedor ? ` · ${UIList._esc(r.fornecedor)}` : ''}</div>
          ${r.ultima_geracao ? `<div class="rec-meta">Última geração: ${fmt.date(r.ultima_geracao)}</div>` : ''}
          ${canEdit ? `<div class="rec-actions">
            <button class="btn-sm btn-sm--success" onclick="app.gerarRecorrencia('${r.id}')">
              <span class="material-symbols-rounded" style="font-size:14px;">bolt</span> Gerar este mês
            </button>
            <button class="btn-sm btn-sm--edit" onclick="app.editRecorrencia('${r.id}')">
              <span class="material-symbols-rounded" style="font-size:14px;">edit</span> Editar
            </button>
            <button class="btn-sm ${r.ativa ? 'btn-sm--danger' : 'btn-sm--success'}" onclick="app.toggleRecorrencia('${r.id}', ${r.ativa})">
              ${r.ativa ? '⏸ Pausar' : '▶ Ativar'}
            </button>
          </div>` : ''}
        </div>
        <div class="rec-right">
          <div class="rec-valor">${val}</div>
        </div>
      </div>`;
    }).join('');
  },
};

// ============================================================
// MODAL
// ============================================================
const Modal = {
  _tipo: 'RECEITA',

  open(tipo) {
    this._tipo = tipo;
    State._uploadResult = null;
    document.getElementById('field-tipo').style.display = '';
    document.getElementById('finance-form').reset();
    document.getElementById('finance-form').style.display = '';
    document.getElementById('futura-form').style.display = 'none';
    document.getElementById('recorrencia-form').style.display = 'none';
    document.getElementById('tx-id').value = '';
    document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('btn-delete').classList.add('hidden');
    document.getElementById('upload-progress').style.display = 'none';
    document.getElementById('comprovante-preview').style.display = 'none';
    document.getElementById('file-upload-area').style.display = '';
    document.getElementById('modal-title').textContent = 'Novo Registro';
    document.getElementById('parcelas-preview').style.display = 'none';
    document.getElementById('valor-converted').style.display = 'none';
    document.getElementById('iva-hint').style.display = 'none';

    if (tipo === 'RECEITA_FUTURA') {
      this._openFuturaForm(null);
      return;
    }
    if (tipo === 'RECORRENCIA') {
      this._openRecorrenciaForm(null);
      return;
    }

    this._setTipo(tipo === 'DESPESA' ? 'DESPESA' : 'RECEITA');
    this._fillSelects();
    this._show();
  },

  _setTipo(tipo) {
    this._tipo = tipo;
    document.getElementById('btn-tipo-receita').classList.toggle('active', tipo === 'RECEITA');
    document.getElementById('btn-tipo-despesa').classList.toggle('active', tipo === 'DESPESA');
    document.getElementById('field-fonte').style.display    = tipo === 'RECEITA' ? '' : 'none';
    document.getElementById('fields-despesa').style.display = tipo === 'DESPESA' ? '' : 'none';
    document.getElementById('field-parcelas').style.display = tipo === 'DESPESA' ? '' : 'none';
    document.getElementById('iva-hint').style.display = 'none';
  },

  _fillSelects() {
    const fonteEl = document.getElementById('tx-fonte');
    const catEl   = document.getElementById('tx-categoria');
    if (fonteEl) fonteEl.innerHTML = '<option value="">— selecione —</option>' +
      State.fontes.map(f => `<option value="${f.id}">${f.icone} ${UIList._esc(f.nome)}</option>`).join('');
    if (catEl) catEl.innerHTML = '<option value="">— selecione —</option>' +
      State.categorias.map(c => `<option value="${c.id}">${c.icone} ${UIList._esc(c.nome)}</option>`).join('');
    this._fillRecFonteCat();
  },

  _fillRecFonteCat() {
    const fonteEl = document.getElementById('fut-fonte');
    const catEl   = document.getElementById('rec-categoria');
    if (fonteEl) fonteEl.innerHTML = '<option value="">— selecione —</option>' +
      State.fontes.map(f => `<option value="${f.id}">${f.icone} ${UIList._esc(f.nome)}</option>`).join('');
    if (catEl) catEl.innerHTML = '<option value="">— selecione —</option>' +
      State.categorias.map(c => `<option value="${c.id}">${c.icone} ${UIList._esc(c.nome)}</option>`).join('');
  },

  _openFuturaForm(data) {
    document.getElementById('finance-form').style.display = 'none';
    document.getElementById('recorrencia-form').style.display = 'none';
    document.getElementById('futura-form').style.display = '';
    document.getElementById('field-tipo').style.display = 'none';
    document.getElementById('modal-title').textContent = data ? 'Editar Receita Prevista' : 'Nova Receita Prevista';
    const delBtn = document.getElementById('fut-btn-delete');
    if (data) {
      document.getElementById('fut-id').value         = data.id;
      document.getElementById('fut-data').value       = data.data_prevista;
      document.getElementById('fut-descricao').value  = data.descricao;
      document.getElementById('fut-fonte').value      = data.fonte_receita_id || '';
      document.getElementById('fut-moeda').value      = data.moeda;
      document.getElementById('fut-valor').value      = data.valor_esperado;
      document.getElementById('fut-status').value     = data.status;
      document.getElementById('fut-recorrente').checked = data.is_recorrente;
      document.getElementById('fut-frequencia').value = data.frequencia || 'MENSAL';
      document.getElementById('fut-obs').value        = data.observacoes || '';
      document.getElementById('fut-field-freq').style.display = data.is_recorrente ? '' : 'none';
      if (delBtn) delBtn.classList.remove('hidden');
    } else {
      document.getElementById('futura-form').reset();
      document.getElementById('fut-id').value = '';
      document.getElementById('fut-data').value = new Date().toISOString().split('T')[0];
      document.getElementById('fut-field-freq').style.display = 'none';
      if (delBtn) delBtn.classList.add('hidden');
    }
    this._fillRecFonteCat();
    this._show();
  },

  _openRecorrenciaForm(data) {
    document.getElementById('finance-form').style.display = 'none';
    document.getElementById('futura-form').style.display = 'none';
    document.getElementById('recorrencia-form').style.display = '';
    document.getElementById('field-tipo').style.display = 'none';
    document.getElementById('modal-title').textContent = data ? 'Editar Recorrência' : 'Nova Despesa Recorrente';
    const delBtn = document.getElementById('rec-btn-delete');
    if (data) {
      document.getElementById('rec-id').value          = data.id;
      document.getElementById('rec-descricao').value   = data.descricao;
      document.getElementById('rec-categoria').value   = data.categoria_despesa_id || '';
      document.getElementById('rec-dia').value         = data.dia_vencimento || '';
      document.getElementById('rec-fornecedor').value  = data.fornecedor || '';
      document.getElementById('rec-moeda').value       = data.moeda;
      document.getElementById('rec-valor').value       = data.valor_estimado || '';
      if (delBtn) delBtn.classList.remove('hidden');
    } else {
      document.getElementById('recorrencia-form').reset();
      document.getElementById('rec-id').value = '';
      if (delBtn) delBtn.classList.add('hidden');
    }
    this._fillRecFonteCat();
    this._show();
  },

  populateTx(t) {
    document.getElementById('tx-id').value            = t.id;
    document.getElementById('tx-date').value          = t.data;
    document.getElementById('tx-moeda').value         = t.moeda;
    document.getElementById('tx-valor').value         = t.valor;
    document.getElementById('tx-status').value        = t.status;
    document.getElementById('tx-fonte').value         = t.fonte_receita_id || '';
    document.getElementById('tx-categoria').value     = t.categoria_despesa_id || '';
    document.getElementById('tx-fornecedor').value    = t.fornecedor || '';
    document.getElementById('tx-iva').value           = t.valor_iva || '';
    document.getElementById('tx-descricao').value     = t.descricao || '';
    document.getElementById('tx-metodo').value        = t.metodo_pagamento || 'Efectivo';
    document.getElementById('tx-conciliado').checked  = !!t.conciliado;
    document.getElementById('tx-obs').value           = t.observacoes || '';
    document.getElementById('tx-parcela-atual').value = t.parcela_atual || 1;
    document.getElementById('tx-total-parcelas').value = t.total_parcelas || 1;
    document.getElementById('btn-delete').classList.remove('hidden');
    document.getElementById('modal-title').textContent = 'Editar Registro';

    // Comprovante preview
    this._showComprovantePreview(t);

    this._setTipo(t.tipo === 'DESPESA' ? 'DESPESA' : 'RECEITA');
    this._fillSelects();
    // Re-set selects after fill
    document.getElementById('tx-fonte').value     = t.fonte_receita_id || '';
    document.getElementById('tx-categoria').value = t.categoria_despesa_id || '';

    this._show();
  },

  _showComprovantePreview(t) {
    const el = document.getElementById('comprovante-preview');
    if (!el) return;
    if (t.comprovante_url) {
      el.style.display = 'block';
      document.getElementById('file-upload-area').style.display = 'none';

      // Determina URL de embed: para imagens do Drive usamos o embedUrl se disponível
      const embedUrl = t.comprovante_embed_url || t.comprovante_url;
      const viewUrl  = t.comprovante_url;
      const nome     = UIList._esc(t.comprovante_nome || 'comprovante');

      if (t.comprovante_tipo === 'image') {
        // Imagens do Drive: usar o link direto de download para preview inline
        const imgSrc = t.comprovante_download_url || embedUrl;
        el.innerHTML = `
          <img src="${imgSrc}" alt="Comprovante" style="width:100%;max-height:140px;object-fit:cover;display:block;">
          <div style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center;background:var(--surface-2);">
            <span style="font-size:.72rem;color:var(--text-3);">${nome}</span>
            <div style="display:flex;gap:6px;">
              <a href="${viewUrl}" target="_blank" class="btn-sm btn-sm--edit" style="text-decoration:none;">
                <span class="material-symbols-rounded" style="font-size:13px;">open_in_new</span> Ver
              </a>
              <button class="btn-sm btn-sm--danger" onclick="Modal._removeComprovante()">Remover</button>
            </div>
          </div>`;
      } else {
        // PDF
        el.innerHTML = `
          <div class="pdf-preview">
            <span class="material-symbols-rounded" style="font-size:2rem;color:var(--danger);">picture_as_pdf</span>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${nome}</div>
              <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
                <a href="${viewUrl}" target="_blank" class="btn-sm btn-sm--edit" style="text-decoration:none;">
                  <span class="material-symbols-rounded" style="font-size:13px;">open_in_new</span> Abrir no Drive
                </a>
                <a href="${t.comprovante_download_url || viewUrl}" target="_blank" class="btn-sm btn-sm--success" style="text-decoration:none;">
                  <span class="material-symbols-rounded" style="font-size:13px;">download</span> Download
                </a>
                <button class="btn-sm btn-sm--danger" onclick="Modal._removeComprovante()">Remover</button>
              </div>
            </div>
          </div>`;
      }
    } else {
      el.style.display = 'none';
      document.getElementById('file-upload-area').style.display = '';
    }
  },

  _removeComprovante() {
    State._uploadResult = { url: null, public_id: null, tipo: null, nome: null, _removed: true };
    document.getElementById('comprovante-preview').style.display = 'none';
    document.getElementById('file-upload-area').style.display = '';
  },

  close() {
    const content = document.getElementById('modal-content');
    content.classList.remove('active');
    setTimeout(() => document.getElementById('modal').classList.add('hidden'), 320);
  },

  _show() {
    document.getElementById('modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-content').classList.add('active'), 30);
  },

  setTipoPub(t) { this._setTipo(t); },

  updateIvaHint() {
    const iva   = parseFloat(document.getElementById('tx-iva')?.value) || 0;
    const total = parseFloat(document.getElementById('tx-valor')?.value) || 0;
    const el    = document.getElementById('iva-hint');
    if (!el) return;
    if (iva > 0 && total > 0) {
      const base = total - iva;
      const pct  = ((iva / total) * 100).toFixed(1);
      el.style.display = 'block';
      el.textContent = `Base: ${fmt.pyg(base)} | IVA (${pct}%): ${fmt.pyg(iva)} | Total: ${fmt.pyg(total)}`;
    } else {
      el.style.display = 'none';
    }
  },

  updateConvertedValue() {
    const moeda = document.getElementById('tx-moeda')?.value;
    const valor = parseFloat(document.getElementById('tx-valor')?.value) || 0;
    const el    = document.getElementById('valor-converted');
    if (!el) return;
    if (moeda !== 'PYG' && valor > 0) {
      el.style.display = 'block';
      el.textContent = `≈ ${fmt.pyg(ExchangeAPI.toPYG(valor, moeda))} (câmbio atual)`;
    } else {
      el.style.display = 'none';
    }
  },

  updateParcelasPreview() {
    const n   = parseInt(document.getElementById('tx-total-parcelas')?.value) || 1;
    const v   = parseFloat(document.getElementById('tx-valor')?.value) || 0;
    const d   = document.getElementById('tx-date')?.value;
    const pre = document.getElementById('parcelas-preview');
    if (!pre) return;
    if (n <= 1) { pre.style.display = 'none'; return; }
    const [y, m, dd] = d ? d.split('-').map(Number) : [0,0,0];
    let html = `<strong>${n}x de ${v > 0 ? fmt.money(v, document.getElementById('tx-moeda')?.value || 'PYG') : '—'}</strong><br>`;
    for (let i = 0; i < Math.min(n, 5); i++) {
      const mi = (m - 1 + i) % 12, yi = Math.floor((m - 1 + i) / 12);
      html += `• ${i + 1}ª: ${String(dd).padStart(2,'0')}/${String(mi + 1).padStart(2,'0')}/${y + yi}<br>`;
    }
    if (n > 5) html += `… até a ${n}ª parcela`;
    pre.style.display = 'block';
    pre.innerHTML = html;
  },
};

// ============================================================
// FORM HANDLER
// ============================================================
const FormHandler = {
  setup() {
    // Main form (TX)
    document.getElementById('finance-form').onsubmit = async e => {
      e.preventDefault();
      await this._saveTx(e.target);
    };

    // Futura form
    document.getElementById('futura-form').onsubmit = async e => {
      e.preventDefault();
      await this._saveFutura(e.target);
    };

    // Recorrência form
    document.getElementById('recorrencia-form').onsubmit = async e => {
      e.preventDefault();
      await this._saveRecorrencia(e.target);
    };
  },

  _setLoading(formId, loading) {
    const btn = document.querySelector(`#${formId} .btn-submit`);
    if (!btn) return;
    btn.disabled  = loading;
    btn.innerHTML = loading
      ? '<span class="material-symbols-rounded spin">progress_activity</span> Salvando…'
      : '<span class="material-symbols-rounded">save</span> Salvar';
  },

  async _saveTx(form) {
    this._setLoading('finance-form', true);
    try {
      const id   = document.getElementById('tx-id').value;
      const file = document.getElementById('tx-file')?.files[0];
      let uploadData = State._uploadResult;

      // Upload file if new file selected
      if (file) {
        document.getElementById('upload-progress').style.display = 'flex';
        try {
          uploadData = await DriveUpload.upload(file, pct => {
            document.getElementById('upload-bar').style.width = pct + '%';
            document.getElementById('upload-pct').textContent = pct + '%';
          });
          State._uploadResult = uploadData;
        } catch (e) {
          UIToast.show('Erro no upload: ' + e.message, 'danger');
          document.getElementById('upload-progress').style.display = 'none';
          return;
        }
        document.getElementById('upload-progress').style.display = 'none';
      }

      const payload = this._txPayload(uploadData);

      let err;
      if (id) {
        err = await DB.update('transacoes', id, payload);
      } else if (payload.total_parcelas > 1) {
        err = await DB.insertMany('transacoes', this._buildInstallments(payload));
      } else {
        err = await DB.insert('transacoes', payload);
      }

      if (err) { UIToast.show('Erro: ' + err.message, 'danger', 5000); return; }
      if (State.isOnline) UIToast.show('✅ Salvo com sucesso!', 'success');
      Modal.close();
      if (State.isOnline) app.fetchData();
    } finally {
      this._setLoading('finance-form', false);
    }
  },

  _txPayload(uploadData) {
    const tipo      = Modal._tipo;
    const isSocio   = Auth.isSocio();
    const moeda     = document.getElementById('tx-moeda').value;

    const base = {
      tipo,
      moeda,
      valor:                parseFloat(document.getElementById('tx-valor').value),
      data:                 document.getElementById('tx-date').value,
      status:               document.getElementById('tx-status').value,
      descricao:            document.getElementById('tx-descricao').value || null,
      metodo_pagamento:     document.getElementById('tx-metodo').value || null,
      observacoes:          document.getElementById('tx-obs').value || null,
      conciliado:           document.getElementById('tx-conciliado').checked,
      parcela_atual:        parseInt(document.getElementById('tx-parcela-atual').value) || 1,
      total_parcelas:       parseInt(document.getElementById('tx-total-parcelas').value) || 1,
      taxa_cambio_brl_pyg:  State.exchangeRates.BRL_PYG,
      taxa_cambio_usd_pyg:  State.exchangeRates.USD_PYG,
    };

    if (tipo === 'RECEITA') {
      base.fonte_receita_id = document.getElementById('tx-fonte').value || null;
    } else {
      base.categoria_despesa_id = document.getElementById('tx-categoria').value || null;
      base.fornecedor           = document.getElementById('tx-fornecedor').value || null;
      base.valor_iva            = parseFloat(document.getElementById('tx-iva').value) || null;
    }

    // Conciliação com quem
    if (base.conciliado && isSocio) {
      base.conciliado_por = State.user?.id;
      base.conciliado_em  = new Date().toISOString();
    }

      if (uploadData) {
      if (uploadData._removed) {
        base.comprovante_url          = null;
        base.comprovante_nome         = null;
        base.comprovante_tipo         = null;
        base.comprovante_public_id    = null;
        base.comprovante_download_url = null;
        base.comprovante_embed_url    = null;
      } else {
        base.comprovante_url          = uploadData.url;
        base.comprovante_nome         = uploadData.nome;
        base.comprovante_tipo         = uploadData.tipo;
        base.comprovante_public_id    = uploadData.public_id;
        base.comprovante_download_url = uploadData.downloadUrl || null;
        base.comprovante_embed_url    = uploadData.embedUrl   || null;
      }
    }

    return base;
  },

  _buildInstallments(base) {
    const [y, m, d] = base.data.split('-').map(Number);
    return Array.from({ length: base.total_parcelas }, (_, i) => {
      const mi = (m - 1 + i) % 12;
      const yi = y + Math.floor((m - 1 + i) / 12);
      return {
        ...base,
        parcela_atual: i + 1,
        data: `${yi}-${String(mi + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
        status: i === 0 ? (base.status || 'CONCLUIDO') : 'PENDENTE',
        is_recorrente: base.total_parcelas > 1,
        recorrencia_id: crypto.randomUUID(),
      };
    });
  },

  async _saveFutura(form) {
    this._setLoading('futura-form', true);
    try {
      const id      = document.getElementById('fut-id').value;
      const payload = {
        descricao:       document.getElementById('fut-descricao').value,
        fonte_receita_id: document.getElementById('fut-fonte').value || null,
        valor_esperado:  parseFloat(document.getElementById('fut-valor').value),
        moeda:           document.getElementById('fut-moeda').value,
        data_prevista:   document.getElementById('fut-data').value,
        status:          document.getElementById('fut-status').value,
        is_recorrente:   document.getElementById('fut-recorrente').checked,
        frequencia:      document.getElementById('fut-recorrente').checked ? document.getElementById('fut-frequencia').value : null,
        observacoes:     document.getElementById('fut-obs').value || null,
      };
      const err = id ? await DB.update('receitas_futuras', id, payload) : await DB.insert('receitas_futuras', payload);
      if (err) { UIToast.show('Erro: ' + err.message, 'danger'); return; }
      UIToast.show('✅ Salvo!', 'success');
      Modal.close();
      if (State.isOnline) app.fetchData();
    } finally {
      this._setLoading('futura-form', false);
    }
  },

  async _saveRecorrencia(form) {
    this._setLoading('recorrencia-form', true);
    try {
      const id      = document.getElementById('rec-id').value;
      const payload = {
        descricao:            document.getElementById('rec-descricao').value,
        categoria_despesa_id: document.getElementById('rec-categoria').value || null,
        dia_vencimento:       parseInt(document.getElementById('rec-dia').value) || null,
        fornecedor:           document.getElementById('rec-fornecedor').value || null,
        moeda:                document.getElementById('rec-moeda').value,
        valor_estimado:       parseFloat(document.getElementById('rec-valor').value) || null,
        ativa:                true,
      };
      const err = id ? await DB.update('despesas_recorrentes', id, payload) : await DB.insert('despesas_recorrentes', payload);
      if (err) { UIToast.show('Erro: ' + err.message, 'danger'); return; }
      UIToast.show('✅ Recorrência salva!', 'success');
      Modal.close();
      if (State.isOnline) app.fetchData();
    } finally {
      this._setLoading('recorrencia-form', false);
    }
  },
};

// ============================================================
// PRINT REPORT
// ============================================================
const PrintReport = {
  print() {
    const txs   = State.transactions.filter(t => {
      if (State.filterTipo !== 'TUDO' && t.tipo !== State.filterTipo) return false;
      if (State.searchQuery && ![t.descricao, t.fornecedor, t.fontes_receita?.nome, t.categorias_despesa?.nome].some(v => v?.toLowerCase().includes(State.searchQuery))) return false;
      return true;
    });
    const rec  = Calc.totalReceitas(txs);
    const dep  = Calc.totalDespesas(txs);
    const res  = rec - dep;
    const rows = txs.sort((a,b) => a.data < b.data ? -1 : 1).map(t => {
      const isRec = t.tipo === 'RECEITA';
      const c = isRec ? '#10b981' : '#ef4444';
      const nome = t.fontes_receita?.nome || t.categorias_despesa?.nome || t.descricao || '—';
      const comp = t.comprovante_url ? `<a href="${t.comprovante_url}" target="_blank" style="color:#6366f1;text-decoration:none;">📎</a>` : '';
      return `<tr>
        <td>${fmt.date(t.data)}</td>
        <td style="color:${c};font-weight:700">${t.tipo}</td>
        <td>${UIList._esc(nome)}</td>
        <td>${UIList._esc(t.fornecedor || '—')}</td>
        <td>${UIList._esc(t.metodo_pagamento || '—')}</td>
        <td style="text-align:right;font-weight:700;color:${c}">${isRec ? '+' : '−'} ${fmt.money(t.valor, t.moeda)}</td>
        <td style="text-align:center">${t.conciliado ? '✓' : ''}</td>
        <td>${comp}</td>
      </tr>`;
    }).join('');
    const month = document.getElementById('filter-month').value;
    const [y, m] = (month || '').split('-');
    const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const label = y && m ? `${MONTHS[parseInt(m)-1]}/${y}` : month;

    const html = `<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8">
<title>Relatório — Simbora Food Park — ${label}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#1e1b4b;padding:16px;background:#fff}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #f59e0b;padding-bottom:10px;margin-bottom:14px}
.hdr-title{font-size:20px;font-weight:800;color:#0d0b08}
.hdr-sub{font-size:11px;color:#6b7280;margin-top:3px}
.hdr-meta{font-size:9px;color:#9ca3af;text-align:right}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
.card{border:1.5px solid #e5e7eb;border-radius:8px;padding:8px 10px}
.card h4{font-size:7px;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:3px}
.card strong{font-size:14px;font-weight:800;display:block}
.green strong{color:#10b981}.red strong{color:#ef4444}.blue strong{color:#3b82f6}
table{width:100%;border-collapse:collapse;font-size:10px}
thead tr{background:#0d0b08;color:#fff}
thead th{padding:5px 6px;text-align:left;font-weight:600;font-size:8.5px}
tbody tr{border-bottom:1px solid #f1f5f9}
tbody tr:nth-child(even){background:#fafafa}
td{padding:4px 6px;vertical-align:middle}
.footer{margin-top:12px;padding-top:7px;border-top:1px solid #e5e7eb;font-size:8px;color:#9ca3af;display:flex;justify-content:space-between}
@media print{@page{margin:10mm 8mm;size:A4 portrait}body{padding:0}}
</style></head><body>
<div class="hdr">
  <div>
    <div class="hdr-title">🍺 Simbora Food Park</div>
    <div class="hdr-sub">Relatório Financeiro — ${label}</div>
  </div>
  <div class="hdr-meta">Gerado em ${new Date().toLocaleString('pt-BR')}<br>₲/${State.exchangeRates.BRL_PYG.toFixed(0)} · $/${State.exchangeRates.USD_PYG.toFixed(0)}</div>
</div>
<div class="cards">
  <div class="card green"><h4>Receitas</h4><strong>${fmt.pyg(rec)}</strong></div>
  <div class="card red"><h4>Despesas</h4><strong>${fmt.pyg(dep)}</strong></div>
  <div class="card ${res>=0?'blue':'red'}"><h4>Resultado</h4><strong>${fmt.signed(res,fmt.pyg)}</strong></div>
</div>
<table><thead><tr>
  <th>Data</th><th>Tipo</th><th>Categoria/Fonte</th><th>Fornecedor</th><th>Método</th>
  <th style="text-align:right">Valor</th><th>Conc.</th><th>📎</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="footer"><span>Simbora Food Park · ${label}</span><span>BRL/PYG: ${State.exchangeRates.BRL_PYG.toFixed(0)} · USD/PYG: ${State.exchangeRates.USD_PYG.toFixed(0)}</span></div>
<script>window.onload=()=>window.print();<\/script>
</body></html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { UIToast.show('⚠️ Permita pop-ups para imprimir', 'warning'); return; }
    win.document.write(html);
    win.document.close();
  },
};

// ============================================================
// APP
// ============================================================
const app = {
  async init() {
    UIToast.init();
    UIConnStatus.update(navigator.onLine);
    OfflineQueue.init();
    UIAuth.setup();
    FormHandler.setup();

    const loggedIn = await Auth.init();
    if (loggedIn) {
      UIAuth.showApp();
      await this.bootstrap();
    } else {
      UIAuth.showLogin();
    }

    PWAInstall.init();
    this._registerSW();
  },

  async bootstrap() {
    // Load fontes + categorias (reference data)
    [State.fontes, State.categorias] = await Promise.all([DB.fetchFontes(), DB.fetchCategorias()]);

    // Set default month
    const now   = new Date();
    const input = document.getElementById('filter-month');
    input.value    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    input.onchange = () => this.fetchData();

    await ExchangeAPI.fetch();
    UILoading.show('tx-list');
    await this.fetchData();
  },

  async fetchData() {
    const val = document.getElementById('filter-month').value;
    if (!val) return;
    const [year, month] = val.split('-');
    State.currentMonth = val;

    const [txs, futuras, recurring] = await Promise.all([
      DB.fetchTransactions(year, month),
      DB.fetchFutureRevenues(year, month),
      DB.fetchRecurring(),
    ]);
    State.transactions   = txs;
    State.futureRevenues = futuras;
    State.recurring      = recurring;

    UIHeader.update(txs);
    this._applyListFilter();

    if (document.getElementById('view-dashboard').classList.contains('active-view')) {
      UIDashboard.update(txs, futuras);
    }
    if (document.getElementById('view-futuras').classList.contains('active-view')) {
      UIFuturas.render(futuras);
    }
    if (document.getElementById('view-recorrencias').classList.contains('active-view')) {
      UIRecorrencias.render(recurring);
    }
  },

  _applyListFilter() {
    let data = State.transactions;
    if (State.filterTipo !== 'TUDO') data = data.filter(t => t.tipo === State.filterTipo);
    if (State.searchQuery) {
      const q = State.searchQuery.toLowerCase();
      data = data.filter(t => [t.descricao, t.fornecedor, t.fontes_receita?.nome, t.categorias_despesa?.nome, t.observacoes].some(v => v?.toLowerCase().includes(q)));
    }
    UIList.render(data);
  },

  switchTab(tab, btnEl) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    const views = ['dashboard','transacoes','futuras','recorrencias'];
    views.forEach(v => {
      const el = document.getElementById(`view-${v}`);
      if (el) {
        el.classList.toggle('active-view', v === tab);
        el.classList.toggle('hidden-view', v !== tab);
      }
    });
    State.currentView = tab;
    if (tab === 'dashboard')    UIDashboard.update(State.transactions, State.futureRevenues);
    if (tab === 'futuras')      UIFuturas.render(State.futureRevenues);
    if (tab === 'recorrencias') UIRecorrencias.render(State.recurring);
  },

  filterTipo(tipo, btnEl) {
    State.filterTipo = tipo;
    document.querySelectorAll('.filter-bar .chip').forEach(c => c.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    this._applyListFilter();
  },

  filterFutura(status, btnEl) {
    State.filterFutura = status;
    document.querySelectorAll('#view-futuras .chip').forEach(c => c.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    UIFuturas.render(State.futureRevenues);
  },

  onSearch() {
    State.searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
    this._applyListFilter();
  },

  openModal(tipo) {
    if (!Auth.isSocio()) { UIToast.show('⛔ Apenas sócios podem lançar registros', 'warning'); return; }
    Modal.open(tipo);
  },

  closeModal() { Modal.close(); },

  handleModalOverlayClick(e) {
    if (e.target === document.getElementById('modal')) Modal.close();
  },

  setTipo(t) { Modal.setTipoPub(t); },

  onMoedaChange()     { Modal.updateConvertedValue(); },
  onIvaChange()       { Modal.updateIvaHint(); },
  onParcelasChange()  { Modal.updateParcelasPreview(); },
  onFutRecorrenteChange() {
    const checked = document.getElementById('fut-recorrente')?.checked;
    document.getElementById('fut-field-freq').style.display = checked ? '' : 'none';
  },

  onFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const content = document.getElementById('file-upload-content');
    if (content) {
      const icon = file.type.startsWith('image') ? 'image' : 'picture_as_pdf';
      content.innerHTML = `<span class="material-symbols-rounded" style="color:var(--primary)">${icon}</span>
        <span style="color:var(--primary);font-weight:700">${UIList._esc(file.name)}</span>
        <span style="font-size:.7rem;opacity:.7">${(file.size / 1024).toFixed(0)} KB</span>`;
    }
  },

  editTx(id) {
    const t = State.transactions.find(x => x.id === id);
    if (!t) return;
    if (!Auth.isSocio()) { UIToast.show('⛔ Apenas sócios podem editar', 'warning'); return; }
    State._uploadResult = null;
    Modal.populateTx(t);
  },

  async deleteTx() {
    const id = document.getElementById('tx-id').value;
    if (!id || !confirm('Excluir este registro definitivamente?')) return;
    const err = await DB.delete('transacoes', id);
    if (err) { UIToast.show('Erro: ' + err.message, 'danger'); return; }
    UIToast.show('🗑️ Excluído', 'info');
    Modal.close();
    if (State.isOnline) this.fetchData();
  },

  editFutura(id) {
    const f = State.futureRevenues.find(x => x.id === id);
    if (!f || !Auth.isSocio()) return;
    Modal._openFuturaForm(f);
    document.getElementById('field-tipo').style.display = 'none';
    document.getElementById('modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-content').classList.add('active'), 30);
  },

  async deleteFutura() {
    const id = document.getElementById('fut-id').value;
    if (!id || !confirm('Excluir esta receita prevista?')) return;
    const err = await DB.delete('receitas_futuras', id);
    if (err) { UIToast.show('Erro: ' + err.message, 'danger'); return; }
    UIToast.show('🗑️ Excluído', 'info');
    Modal.close();
    if (State.isOnline) this.fetchData();
  },

  async realizarFutura(id) {
    const f = State.futureRevenues.find(x => x.id === id);
    if (!f) return;
    // Abre modal de nova receita pré-preenchida
    Modal.open('RECEITA');
    await new Promise(r => setTimeout(r, 50));
    document.getElementById('tx-descricao').value = f.descricao;
    document.getElementById('tx-moeda').value     = f.moeda;
    document.getElementById('tx-valor').value     = f.valor_esperado;
    document.getElementById('tx-fonte').value     = f.fonte_receita_id || '';
    document.getElementById('tx-date').value      = f.data_prevista || new Date().toISOString().split('T')[0];
    // Ao salvar, marcar a futura como realizada automaticamente via DB trigger ou app logic
    UIToast.show('💡 Receita pré-preenchida. Confirme e salve.', 'info', 4000);
  },

  async cancelarFutura(id) {
    if (!confirm('Cancelar esta receita prevista?')) return;
    const err = await DB.update('receitas_futuras', id, { status: 'CANCELADO' });
    if (err) { UIToast.show('Erro: ' + err.message, 'danger'); return; }
    UIToast.show('✕ Receita cancelada', 'info');
    this.fetchData();
  },

  editRecorrencia(id) {
    const r = State.recurring.find(x => x.id === id);
    if (!r || !Auth.isSocio()) return;
    Modal._openRecorrenciaForm(r);
    document.getElementById('field-tipo').style.display = 'none';
    document.getElementById('modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-content').classList.add('active'), 30);
  },

  async deleteRecorrencia() {
    const id = document.getElementById('rec-id').value;
    if (!id || !confirm('Excluir esta recorrência?')) return;
    const err = await DB.delete('despesas_recorrentes', id);
    if (err) { UIToast.show('Erro: ' + err.message, 'danger'); return; }
    UIToast.show('🗑️ Excluído', 'info');
    Modal.close();
    this.fetchData();
  },

  async toggleRecorrencia(id, currentAtiva) {
    const err = await DB.update('despesas_recorrentes', id, { ativa: !currentAtiva });
    if (err) { UIToast.show('Erro: ' + err.message, 'danger'); return; }
    UIToast.show(currentAtiva ? '⏸ Recorrência pausada' : '▶ Recorrência ativada', 'info');
    this.fetchData();
  },

  async gerarRecorrencia(id) {
    const r = State.recurring.find(x => x.id === id);
    if (!r) return;
    const val = document.getElementById('filter-month').value;
    const [year, month] = val.split('-');
    const day    = r.dia_vencimento || 1;
    const data   = `${year}-${month}-${String(Math.min(day, 28)).padStart(2,'0')}`;

    const payload = {
      tipo:                 'DESPESA',
      moeda:                r.moeda,
      valor:                r.valor_estimado || 1,
      data,
      status:               'PENDENTE',
      categoria_despesa_id: r.categoria_despesa_id,
      fornecedor:           r.fornecedor,
      descricao:            r.descricao,
      is_recorrente:        true,
      recorrencia_id:       r.id,
      parcela_atual:        1,
      total_parcelas:       1,
      conciliado:           false,
      taxa_cambio_brl_pyg:  State.exchangeRates.BRL_PYG,
      taxa_cambio_usd_pyg:  State.exchangeRates.USD_PYG,
    };

    const err = await DB.insert('transacoes', payload);
    if (err) { UIToast.show('Erro: ' + err.message, 'danger'); return; }

    // Update last generation date
    await DB.update('despesas_recorrentes', id, { ultima_geracao: data });
    UIToast.show('✅ Despesa gerada para ' + fmt.date(data), 'success');
    this.fetchData();
  },

  toggleUserMenu() {
    document.getElementById('user-dropdown')?.classList.toggle('hidden');
  },

  printReport() { PrintReport.print(); },

  _registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js')
      .then(reg => { if ('sync' in reg) reg.sync.register('sync-sfp-queue').catch(() => {}); })
      .catch(e => console.warn('[SW]', e));
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SYNC_OFFLINE_QUEUE') OfflineQueue.drain();
    });
  },
};

// Close user menu when clicking outside
document.addEventListener('click', e => {
  const menu = document.getElementById('user-menu');
  if (menu && !menu.contains(e.target)) {
    document.getElementById('user-dropdown')?.classList.add('hidden');
  }
});

// Inject spin style
const _sty = document.createElement('style');
_sty.textContent = `@keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin .8s linear infinite;display:inline-block}`;
document.head.appendChild(_sty);

// ============================================================
// PWA INSTALL BANNER
// ============================================================
const PWAInstall = {
  _deferred: null,
  _isIOS: /iphone|ipad|ipod/i.test(navigator.userAgent),
  _KEY: 'sfp_pwa_dismissed',

  init() {
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    const ts = parseInt(localStorage.getItem(this._KEY) || '0');
    if (Date.now() - ts < 7 * 86400000) return;

    if (this._isIOS) {
      setTimeout(() => this._show('Toque em compartilhar → "Adicionar à Tela de Início"'), 3000);
    } else {
      window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        this._deferred = e;
        setTimeout(() => this._show('Instale para acesso rápido e offline'), 2500);
      });
    }
  },

  _show(msg) {
    // Simple toast-like install hint
    UIToast.show(`📲 ${msg}`, 'info', 8000);
  },
};

// ============================================================
// BOOT
// ============================================================
window.app    = app;
window.Auth   = Auth;
window.Modal  = Modal;
window.OfflineQueue = OfflineQueue;
window.UIAuth = UIAuth;

app.init();