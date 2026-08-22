const STORAGE_PREFIX = 'corebox_operations_v1_';
const MAX_OFFLINE_MS = 24 * 60 * 60 * 1000;
const RESOURCE_LABELS = { ore: 'руда', coal: 'уголь', chips: 'чипы', plasma: 'плазма', trash: 'мусор' };
const SECTORS = {
  core: { label: 'CORE', icon: '◈', risk: 0.12 },
  mining: { label: 'MINING BELT', icon: '⛏', risk: 0.22 },
  rebel: { label: 'REBEL RIM', icon: '⚠', risk: 0.46 },
  void: { label: 'DEEP VOID', icon: '◇', risk: 0.62 },
};
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
  return { active: null, auto: false, mastery: {}, codex: [], sectorHeat: { core: 12, mining: 28, rebel: 46, void: 64 }, control: { sector: 'core', score: 0, expiresAt: 0 }, supportOrder: null, lastReport: null, completed: 0 };
}
function mergeState(raw) { return { ...freshState(), ...raw, sectorHeat: { ...freshState().sectorHeat, ...(raw.sectorHeat || {}) }, mastery: raw.mastery || {}, codex: Array.isArray(raw.codex) ? raw.codex : [] }; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDuration(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function getStats(game) {
  try { return game?.get_statistics?.() || {}; } catch { return {}; }
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
    const active = this.state?.active;
    if (!active || Date.now() < active.endsAt) return;
    const contract = CONTRACTS.find(c => c.id === active.contractId) || CONTRACTS[0];
    const elapsed = Math.min(MAX_OFFLINE_MS, Math.max(0, Date.now() - active.startedAt));
    const heat = Number(this.state.sectorHeat[contract.sector] || 0);
    const safe = (this.state.supportOrder ? 0.12 : 0) + (this.state.mastery[contract.type] || 0) * 0.05;
    const roll = ((active.seed % 100) / 100);
    const danger = Math.min(0.9, contract.risk + heat / 300 - safe);
    const incident = roll < danger;
    const reward = incident ? Math.floor(contract.reward * 0.35) : contract.reward;
    const resource = contract.type === 'recon' ? 'chips' : contract.sector === 'void' ? 'plasma' : 'ore';
    addResource(this.game, resource, reward);
    addPower(this.game, contract.type === 'recon' ? 4 : contract.type === 'guard' ? 2 : 8);
    this.state.sectorHeat[contract.sector] = Math.min(100, Math.max(0, heat + (incident ? 8 : contract.type === 'guard' ? -12 : -6)));
    if (!incident) {
      this.state.control.score += contract.type === 'guard' ? 2 : 1;
      this.state.control.sector = contract.sector;
      this.state.control.expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    }
    this.state.completed += 1;
    this.state.mastery[contract.type] = Math.min(3, (this.state.mastery[contract.type] || 0) + 1);
    const codexId = `${contract.type}:${contract.sector}`;
    if (!this.state.codex.includes(codexId)) this.state.codex.push(codexId);
    this.state.lastReport = { title: contract.title, type: contract.type, sector: contract.sector, incident, resource, reward, elapsed, at: Date.now(), danger: Math.round(danger * 100), mastery: this.state.mastery[contract.type], intel: `Heat ${Math.round(this.state.sectorHeat[contract.sector])} · ${incident ? 'сигнал нестабилен' : 'маршрут подтверждён'}`, support: Boolean(this.state.supportOrder) };
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
    const control = this.state.control.expiresAt > Date.now() ? `${SECTORS[this.state.control.sector]?.label || 'CORE'} · ${this.state.control.score} influence` : 'Нет активного контроля';
    this.host.innerHTML = `<section class="ops-deck" aria-label="Operations Deck"><div class="ops-deck-head"><div><span class="ops-kicker">OPERATIONS DECK</span><h3>${active ? 'АКТИВНЫЙ ПРИКАЗ' : 'ВЫБЕРИТЕ СЛЕДУЮЩИЙ ПРИКАЗ'}</h3></div><div class="ops-clock ${active ? 'is-live' : ''}">${remaining}</div></div><div class="ops-status-line"><span>${active ? `${esc(activeContract?.title)} · ${SECTORS[activeContract?.sector]?.label || ''}` : 'Outpost готов к операции'}</span><button class="ops-mini-btn ${this.state.auto ? 'is-on' : ''}" data-op-auto>${this.state.auto ? 'AUTO ON' : 'SAFE AUTO'}</button><button class="ops-mini-btn ${this.state.supportOrder ? 'is-on' : ''}" data-op-support>${this.state.supportOrder ? 'SUPPORT ON' : 'SUPPORT'}</button></div><div class="ops-control"><span>SECTOR CONTROL</span><b>${control}</b></div><div class="ops-sectors">${sectorHeat}</div><div class="ops-contracts">${contractCards}</div><div class="ops-subgrid"><div><div class="ops-subtitle">WELCOME-BACK</div>${report}</div><div><div class="ops-subtitle">MASTERY</div><div class="ops-mastery-row">${mastery}</div></div></div><div class="ops-archive"><div class="ops-subtitle">CODEX / ARCHIVE <span>${this.state.codex.length}/8</span></div><div class="ops-codex-list">${codex}</div></div></section>`;
    this.host.querySelectorAll('[data-op-start]').forEach(btn => btn.addEventListener('click', () => this.start(btn.dataset.opStart)));
    this.host.querySelector('[data-op-auto]')?.addEventListener('click', () => this.toggleAuto());
    this.host.querySelector('[data-op-support]')?.addEventListener('click', () => this.setSupport());
  },
};

if (typeof window !== 'undefined') window.operationsModule = operationsModule;
