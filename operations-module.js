const STORAGE_PREFIX = 'corebox_operations_v1_';
const MAX_OFFLINE_MS = 24 * 60 * 60 * 1000;
const RESOURCE_LABELS = { ore: 'руда', coal: 'уголь', chips: 'чипы', plasma: 'плазма', trash: 'мусор' };
const SECTORS = {
  core: { label: 'CORE', icon: '◈', risk: 0.12 },
  mining: { label: 'MINING BELT', icon: '⛏', risk: 0.22 },
  rebel: { label: 'REBEL RIM', icon: '⚠', risk: 0.46 },
  void: { label: 'DEEP VOID', icon: '◇', risk: 0.62 },
};
const GOALS = [
  { id: 'first-command', title: 'Первый приказ', text: 'Завершите 1 операцию', target: 1, reward: 25 },
  { id: 'sector-keeper', title: 'Хранитель сектора', text: 'Наберите 5 influence', target: 5, reward: 60 },
  { id: 'archive-runner', title: 'Архивный беглец', text: 'Откройте 3 записи Codex', target: 3, reward: 90 },
];
const PROJECTS = [
  { id: 'relay', title: 'Релейная башня', cost: 80, resource: 'ore', effect: '−10% heat во всех секторах' },
  { id: 'vault', title: 'Хранилище нулевого дня', cost: 120, resource: 'trash', effect: '+1 к награде экспедиции' },
  { id: 'beacon', title: 'Маяк конвоя', cost: 100, resource: 'chips', effect: 'Открывает NPC-конвои и снижает риск Support' },
];
const CONTRACTS = [
  { id: 'ore-run', type: 'expedition', title: 'Сырьевой коридор', sector: 'mining', duration: 90, reward: 42, risk: 0.22, description: 'Стабильная добыча. Малый риск, средняя отдача.' },
  { id: 'signal-hunt', type: 'recon', title: 'Охота за сигналом', sector: 'rebel', duration: 70, reward: 18, risk: 0.38, description: 'Разведка горячей зоны откроет новый intel и heat.' },
  { id: 'watchline', type: 'guard', title: 'Оборона периметра', sector: 'core', duration: 60, reward: 12, risk: 0.12, description: 'Укрепляет сектор и снижает угрозу следующего окна.' },
  { id: 'void-pulse', type: 'expedition', title: 'Импульс из пустоты', sector: 'void', duration: 150, reward: 88, risk: 0.62, description: 'Высокая награда. Возможны задержка и повреждение флота.' },
];

function key(userId) { return `${STORAGE_PREFIX}${userId || 'anon'}`; }
function safeRead(userId) {
  try { return JSON.parse(localStorage.getItem(key(userId)) || '{}'); } catch { return {}; }
}
function safeWrite(userId, state) { try { localStorage.setItem(key(userId), JSON.stringify(state)); } catch {} }
function freshState() {
  return { active: null, auto: false, mastery: {}, codex: [], sectorHeat: { core: 12, mining: 28, rebel: 46, void: 64 }, control: { sector: 'core', score: 0, expiresAt: 0 }, supportOrder: null, lastReport: null, completed: 0, season: { id: 'cycle-01', day: 1, xp: 0 }, goals: {}, projects: {}, factionStanding: { scavengers: 0, technomads: 0, cyber_rebels: 0 }, convoy: null, cycle: { count: 0, ending: null, unlocked: false } };
}
function mergeState(raw) { const base = freshState(); return { ...base, ...raw, sectorHeat: { ...base.sectorHeat, ...(raw.sectorHeat || {}) }, mastery: raw.mastery || {}, codex: Array.isArray(raw.codex) ? raw.codex : [], season: { ...base.season, ...(raw.season || {}) }, goals: raw.goals || {}, projects: raw.projects || {}, factionStanding: { ...base.factionStanding, ...(raw.factionStanding || {}) }, cycle: { ...base.cycle, ...(raw.cycle || {}) } }; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDuration(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function getStats(game) {
  try {
    const raw = game?.get_statistics?.();
    if (!raw) return {};
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch { return {}; }
}
function addResource(game, resource, amount) { try { game?.add_resource?.(resource, Math.max(0, Math.floor(amount))); } catch {} }
function addPower(game, amount) { try { game?.add_power?.(Math.max(0, Math.floor(amount))); } catch {} }

export const operationsModule = {
  game: null, userId: null, state: null, timer: null, host: null,
  init(game, userId) {
    this.game = game; this.userId = userId || 'anon'; this.state = mergeState(safeRead(this.userId));
    this.host = document.getElementById('corebox-ops-deck-host');
    if (!this.host) return;
    this.resolveDue(); this.render();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => { this.resolveDue(); this.render(); }, 1000);
    window.coreboxOperations = this;
  },
  destroy() { if (this.timer) clearInterval(this.timer); this.timer = null; },
  persist() { safeWrite(this.userId, this.state); },
  resolveDue() {
    if (this.state?.convoy && Date.now() >= this.state.convoy.arrivesAt) {
      addResource(this.game, 'ore', this.state.convoy.cargo);
      this.state.lastReport = { ...(this.state.lastReport || {}), title: 'NPC-конвой прибыл', incident: false, reward: this.state.convoy.cargo, resource: 'ore', danger: 0, intel: 'Асинхронный груз доставлен в контролируемый сектор', at: Date.now() };
      this.state.convoy = null;
      this.persist();
      window.showNotif?.('🚚 NPC-конвой прибыл: груз доставлен');
    }
    const active = this.state?.active;
    if (!active || Date.now() < active.endsAt) return;
    const contract = CONTRACTS.find(c => c.id === active.contractId) || CONTRACTS[0];
    const elapsed = Math.min(MAX_OFFLINE_MS, Math.max(0, Date.now() - active.startedAt));
    const heat = Number(this.state.sectorHeat[contract.sector] || 0);
    const safe = (this.state.supportOrder ? 0.12 : 0) + (this.state.projects.beacon ? 0.05 : 0) + (this.state.mastery[contract.type] || 0) * 0.05;
    const roll = ((active.seed % 100) / 100);
    const danger = Math.min(0.9, contract.risk + heat / 300 - safe);
    const incident = roll < danger;
    const projectBonus = this.state.projects.vault && contract.type === 'expedition' ? 1 : 0;
    const reward = (incident ? Math.floor(contract.reward * 0.35) : contract.reward) + projectBonus;
    const resource = contract.type === 'recon' ? 'chips' : contract.sector === 'void' ? 'plasma' : 'ore';
    addResource(this.game, resource, reward);
    addPower(this.game, contract.type === 'recon' ? 4 : contract.type === 'guard' ? 2 : 8);
    this.state.sectorHeat[contract.sector] = Math.min(100, Math.max(5, heat + (incident ? 8 : contract.type === 'guard' ? -8 : -4)));
    if (!incident) {
      this.state.control.score = Math.min(100, this.state.control.score + (contract.type === 'guard' ? 2 : 1));
      this.state.control.sector = contract.sector;
      this.state.control.expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    }
    this.state.completed += 1;
    this.state.mastery[contract.type] = Math.min(3, (this.state.mastery[contract.type] || 0) + 1);
    const codexId = `${contract.type}:${contract.sector}`;
    if (!this.state.codex.includes(codexId)) this.state.codex.push(codexId);
    this.state.lastReport = { title: contract.title, type: contract.type, sector: contract.sector, incident, resource, reward, elapsed, at: Date.now(), danger: Math.round(danger * 100), mastery: this.state.mastery[contract.type], intel: `Heat ${Math.round(this.state.sectorHeat[contract.sector])} · ${incident ? 'сигнал нестабилен' : 'маршрут подтверждён'}`, support: Boolean(this.state.supportOrder) };
    this.state.season.xp += incident ? 1 : 3;
    this.state.season.day = Math.min(30, 1 + Math.floor(this.state.completed / 3));
    this.state.goals['first-command'] = this.state.completed;
    this.state.goals['sector-keeper'] = this.state.control.score;
    this.state.goals['archive-runner'] = this.state.codex.length;
    const faction = contract.sector === 'rebel' ? 'cyber_rebels' : contract.sector === 'void' ? 'technomads' : 'scavengers';
    this.state.factionStanding[faction] = Math.max(-100, Math.min(100, this.state.factionStanding[faction] + (incident ? -1 : 2)));
    this.state.active = null;
    this.state.supportOrder = null;
    this.persist();
    if (window.showNotif) window.showNotif(incident ? `⚠️ Операция завершена с осложнениями: +${reward} ${RESOURCE_LABELS[resource]}` : `✅ Операция завершена: +${reward} ${RESOURCE_LABELS[resource]}`);
    if (this.state.auto && !incident && this.canAutoStart(contract)) this.start(contract.id, true);
  },
  canAutoStart(contract) {
    const heat = Number(this.state.sectorHeat[contract.sector] || 0);
    return heat < 72 && contract.risk < 0.5 && this.state.completed < 10000;
  },
  start(contractId, silent = false) {
    if (this.state.active) return;
    const contract = CONTRACTS.find(c => c.id === contractId);
    if (!contract) return;
    const stats = getStats(this.game);
    const power = Number(stats.computational_power || this.game?.get_computational_power?.() || 0);
    const minPower = contract.type === 'recon' ? 12 : 20;
    if (power < minPower) { if (!silent) window.showNotif?.(`Нужно минимум ${minPower} мощности для приказа`, true); return; }
    this.state.active = { contractId, startedAt: Date.now(), endsAt: Date.now() + contract.duration * 1000, seed: (Date.now() + contract.id.length * 97) % 1000 };
    this.persist(); this.render();
    if (!silent) window.showNotif?.(`▶ Приказ принят: ${contract.title}`);
  },
  toggleAuto() { this.state.auto = !this.state.auto; this.persist(); this.render(); },
  setSupport() { this.state.supportOrder = this.state.supportOrder ? null : { type: 'guard', createdAt: Date.now() }; this.persist(); this.render(); },
  claimGoal(id) { const goal = GOALS.find(g => g.id === id); const claimKey = `claimed:${id}`; if (!goal || this.state.goals[claimKey] || Number(this.state.goals[id] || 0) < goal.target) return; this.state.goals[claimKey] = true; addResource(this.game, 'chips', goal.reward); this.persist(); this.render(); window.showNotif?.(`🏁 Цель выполнена: ${goal.title}`); },
  buildProject(id) { const p = PROJECTS.find(x => x.id === id); if (!p || this.state.projects[id]) return; const stats = getStats(this.game); const available = Number(stats[`${p.resource}_inventory`] || 0); if (available < p.cost) { window.showNotif?.(`Нужно ${p.cost} ${RESOURCE_LABELS[p.resource]}`, true); return; } try { this.game?.subtract_resource?.(p.resource, p.cost); } catch {} this.state.projects[id] = true; if (id === 'relay') Object.keys(this.state.sectorHeat).forEach(k => { this.state.sectorHeat[k] = Math.max(0, this.state.sectorHeat[k] - 10); }); this.persist(); this.render(); window.showNotif?.(`🏗️ Проект завершён: ${p.title}`); },
    runConvoy() { if (this.state.convoy) return; if (!this.state.projects.beacon) { window.showNotif?.('Сначала постройте Маяк конвоя', true); return; } const sector = this.state.control.sector || 'mining';
 this.state.convoy = { sector, arrivesAt: Date.now() + 45000, cargo: 45 }; this.persist(); this.render(); window.showNotif?.('🚚 NPC-конвой отправлен в сектор'); },
  startCycle() { if (this.state.completed < 12 || this.state.cycle.unlocked) return; this.state.cycle.unlocked = true; this.state.cycle.count += 1; this.state.cycle.ending = ['Warden', 'Broker', 'Ghost'][this.state.cycle.count % 3]; this.state.season = { id: `cycle-${String(this.state.cycle.count + 1).padStart(2, '0')}`, day: 1, xp: 0 }; this.state.control.score = 0; this.persist(); this.render(); window.showNotif?.(`◈ Новый цикл: ${this.state.cycle.ending}`); },
  render() {
    if (!this.host) return;
    const active = this.state.active;
    const activeContract = CONTRACTS.find(c => c.id === active?.contractId);
    const remaining = active ? fmtDuration(active.endsAt - Date.now()) : 'ГОТОВ';
    const currentSector = activeContract?.sector || this.state.control.sector;
    const sectorHeat = Object.entries(SECTORS).map(([id, s]) => `<span class="ops-sector-chip ${id === currentSector ? 'is-active' : ''}">${s.icon} ${s.label} <b>${Math.round(this.state.sectorHeat[id] || 0)}</b></span>`).join('');
    const contractCards = CONTRACTS.map(c => { const locked = active || (this.state.sectorHeat[c.sector] || 0) > 88; return `<button class="ops-contract ${locked ? 'is-locked' : ''}" data-op-start="${c.id}" ${locked ? 'disabled' : ''}><span class="ops-contract-top"><b>${esc(c.title)}</b><em>${c.duration}s</em></span><span>${esc(c.description)}</span><small>${c.type === 'recon' ? 'INTEL' : 'YIELD'} · риск ${Math.round(c.risk * 100)}% · +${c.reward}</small></button>`; }).join('');
    const report = this.state.lastReport ? `<div class="ops-report"><b>${this.state.lastReport.incident ? '⚠ COMPLICATION' : '✓ OPERATION CLEAR'}</b><span>${esc(this.state.lastReport.title)} · +${this.state.lastReport.reward} ${RESOURCE_LABELS[this.state.lastReport.resource]} · риск ${this.state.lastReport.danger}%</span><small>${esc(this.state.lastReport.intel)}${this.state.lastReport.support ? ' · SUPPORT прикрытие' : ''}</small></div>` : '<div class="ops-empty">Нет завершённых операций. Выберите первый приказ.</div>';
    const mastery = ['expedition', 'recon', 'guard'].map(type => `<span class="ops-mastery"><b>${type === 'recon' ? 'RECON' : type === 'guard' ? 'GUARD' : 'EXPEDITION'}</b><i>${'◆'.repeat(this.state.mastery[type] || 0)}${'◇'.repeat(3 - (this.state.mastery[type] || 0))}</i></span>`).join('');
    const codex = this.state.codex.length ? this.state.codex.map(x => `<span class="ops-codex-item">▣ ${esc(x.replace(':', ' / '))}</span>`).join('') : '<span class="ops-empty">Архив пуст</span>';
    const goals = GOALS.map(g => { const progress = Math.min(g.target, Number(this.state.goals[g.id] || 0)); const claimed = this.state.goals[`claimed:${g.id}`]; return `<div class="ops-goal"><span><b>${esc(g.title)}</b><small>${esc(g.text)} · ${progress}/${g.target}</small></span><button data-op-goal="${g.id}" ${claimed || progress < g.target ? 'disabled' : ''}>${claimed ? 'CLAIMED' : `+${g.reward}`}</button></div>`; }).join('');
    const projects = PROJECTS.map(p => `<div class="ops-project"><span><b>${esc(p.title)}</b><small>${p.cost} ${RESOURCE_LABELS[p.resource]} · ${esc(p.effect)}</small></span><button data-op-project="${p.id}" ${this.state.projects[p.id] ? 'disabled' : ''}>${this.state.projects[p.id] ? 'BUILT' : 'BUILD'}</button></div>`).join('');
    const convoy = this.state.convoy ? `<span class="ops-codex-item">🚚 ${SECTORS[this.state.convoy.sector]?.label || this.state.convoy.sector} · ${fmtDuration(this.state.convoy.arrivesAt - Date.now())}</span>` : `<button class="ops-mini-btn" data-op-convoy ${this.state.projects.beacon ? '' : 'disabled'}>NPC CONVOY${this.state.projects.beacon ? '' : ' · LOCKED'}</button>`;
    const factions = Object.entries(this.state.factionStanding).map(([id, value]) => `<span class="ops-faction"><b>${id.replace('_', ' ').toUpperCase()}</b><i>${value > 0 ? '+' : ''}${value}</i></span>`).join('');
    const control = this.state.control.expiresAt > Date.now() ? `${SECTORS[this.state.control.sector]?.label || 'CORE'} · ${this.state.control.score} influence` : 'Нет активного контроля';
    this.host.innerHTML = `<section class="ops-deck" aria-label="Operations Deck"><div class="ops-deck-head"><div><span class="ops-kicker">OPERATIONS DECK · ${esc(this.state.season.id)} / DAY ${this.state.season.day}</span><h3>${active ? 'АКТИВНЫЙ ПРИКАЗ' : 'ВЫБЕРИТЕ СЛЕДУЮЩИЙ ПРИКАЗ'}</h3></div><div class="ops-clock ${active ? 'is-live' : ''}">${remaining}</div></div><div class="ops-status-line"><span>${active ? `${esc(activeContract?.title)} · ${SECTORS[activeContract?.sector]?.label || ''}` : 'Outpost готов к операции'}</span><button class="ops-mini-btn ${this.state.auto ? 'is-on' : ''}" data-op-auto>${this.state.auto ? 'AUTO ON' : 'SAFE AUTO'}</button><button class="ops-mini-btn ${this.state.supportOrder ? 'is-on' : ''}" data-op-support>${this.state.supportOrder ? 'SUPPORT ON' : 'SUPPORT'}</button></div><div class="ops-control"><span>SECTOR CONTROL</span><b>${control}</b></div><div class="ops-factions">${factions}</div><div class="ops-sectors">${sectorHeat}</div><div class="ops-contracts">${contractCards}</div><div class="ops-subgrid"><div><div class="ops-subtitle">WELCOME-BACK</div>${report}</div><div><div class="ops-subtitle">MASTERY</div><div class="ops-mastery-row">${mastery}</div></div></div><div class="ops-archive"><div class="ops-subtitle">CODEX / ARCHIVE <span>${this.state.codex.length}/8</span></div><div class="ops-codex-list">${codex}</div></div><div class="ops-retention"><div class="ops-subtitle">LONG-RUN GOALS <span>${this.state.season.xp} XP</span></div>${goals}<div class="ops-subtitle">INFRASTRUCTURE SINKS</div>${projects}<div class="ops-subtitle">ASYNC WORLD</div><div class="ops-codex-list">${convoy}<button class="ops-mini-btn" data-op-cycle ${this.state.completed < 12 || this.state.cycle.unlocked ? 'disabled' : ''}>${this.state.cycle.unlocked ? `CYCLE ${this.state.cycle.count}` : 'UNLOCK CYCLE'}</button></div></div></section>`;
    this.host.querySelectorAll('[data-op-start]').forEach(btn => btn.addEventListener('click', () => this.start(btn.dataset.opStart)));
    this.host.querySelector('[data-op-auto]')?.addEventListener('click', () => this.toggleAuto());
    this.host.querySelector('[data-op-support]')?.addEventListener('click', () => this.setSupport());
    this.host.querySelectorAll('[data-op-goal]').forEach(btn => btn.addEventListener('click', () => this.claimGoal(btn.dataset.opGoal)));
    this.host.querySelectorAll('[data-op-project]').forEach(btn => btn.addEventListener('click', () => this.buildProject(btn.dataset.opProject)));
    this.host.querySelector('[data-op-convoy]')?.addEventListener('click', () => this.runConvoy());
    this.host.querySelector('[data-op-cycle]')?.addEventListener('click', () => this.startCycle());
  },
};

if (typeof window !== 'undefined') window.operationsModule = operationsModule;
