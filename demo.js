(() => {
  'use strict';

  const STORAGE_KEY = 'corebox_public_demo_v1';
  const DEFAULT_STATE = {
    pilot: '',
    day: 1,
    power: 860,
    data: 122,
    credits: 420,
    heat: 18,
    stance: 'balanced',
    missionProgress: 0,
    missionDone: false,
    deployed: false,
    scoutReady: true,
    logs: [
      { time: 'NOW', text: 'Local command node initialized.' },
      { time: '—', text: 'Three contracts are waiting in the operations deck.' },
      { time: '—', text: 'Sector sweep detected 2,000 trace signatures.' }
    ]
  };

  let state = loadState();
  let cycleTimer = null;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return saved && saved.pilot ? { ...DEFAULT_STATE, ...saved } : { ...DEFAULT_STATE };
    } catch (_) {
      return { ...DEFAULT_STATE };
    }
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* private mode */ }
  }

  function nowTime() {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
  }

  function shortTime() {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function addLog(text) {
    state.logs.unshift({ time: nowTime().slice(0, 5), text });
    state.logs = state.logs.slice(0, 8);
    renderActivity();
    persist();
  }

  function toast(text, kind = '') {
    const region = $('#toast-region');
    if (!region) return;
    const item = document.createElement('div');
    item.className = `toast ${kind}`;
    item.textContent = text;
    region.appendChild(item);
    window.setTimeout(() => { item.classList.add('out'); window.setTimeout(() => item.remove(), 300); }, 3400);
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function renderHeader() {
    const name = state.pilot.toUpperCase();
    setText('pilot-name-display', name);
    setText('pilot-avatar', name.charAt(0) || 'N');
    setText('day-count', String(state.day).padStart(2, '0'));
  }

  function renderResources() {
    const power = Math.max(0, Math.round(state.power));
    const heat = Math.max(0, Math.min(100, Math.round(state.heat)));
    setText('power-value', power);
    setText('data-value', Math.round(state.data));
    setText('credit-value', Math.round(state.credits));
    setText('heat-value', heat);
    const powerBar = $('#power-bar');
    if (powerBar) powerBar.style.width = `${Math.min(100, power / 10)}%`;
    const heatState = $('#heat-state');
    if (heatState) {
      heatState.textContent = heat >= 72 ? 'CRITICAL' : heat >= 45 ? 'ELEVATED' : 'QUIET';
      heatState.style.color = heat >= 72 ? 'var(--red)' : heat >= 45 ? 'var(--amber)' : 'var(--green)';
    }
    const progress = state.missionDone ? 100 : Math.round(state.missionProgress);
    setText('mission-progress-label', `${progress}%`);
    const missionBar = $('#mission-progress-bar');
    if (missionBar) missionBar.style.width = `${progress}%`;
    setText('goal-mission', state.missionDone ? '1 / 1' : '0 / 1');
    setText('goal-data', `${Math.round(state.data)} / 250`);
    const missionState = $('#mission-state');
    if (missionState) missionState.textContent = state.missionDone ? 'COMPLETE' : state.deployed ? 'IN FLIGHT' : 'READY';
    const deploy = $('#deploy-button');
    if (deploy) {
      deploy.disabled = state.missionDone || state.deployed;
      deploy.innerHTML = state.missionDone ? 'Relay recovered <span>✓</span>' : state.deployed ? 'Recon in flight <span>…</span>' : 'Deploy recon <span>↗</span>';
    }
  }

  function renderActivity() {
    const feed = $('#activity-feed');
    if (!feed) return;
    feed.innerHTML = state.logs.map((log) => `<div class="activity-line"><time>${escapeHtml(log.time)}</time><span>${escapeHtml(log.text)}</span></div>`).join('');
  }

  function renderStances() {
    $$('.stance').forEach((button) => {
      const active = button.dataset.stance === state.stance;
      button.classList.toggle('is-active', active);
      const tag = button.querySelector('em');
      if (tag) tag.textContent = active ? 'ACTIVE' : 'SELECT';
    });
  }

  function renderOperations() {
    const contracts = [
      { icon: '⌁', title: 'Echo Market sweep', copy: 'Map a neutral trading lane and bring back a clean signal sample.', cost: '−60 POWER', reward: '+45 DATA', tone: 'cyan' },
      { icon: '◇', title: 'Ghost convoy escort', copy: 'Protect a silent hauler through the redline before the next heat pulse.', cost: '−35 POWER', reward: '+110 ₡', tone: 'violet' },
      { icon: '⚠', title: 'Black relay extraction', copy: 'High heat, high value. Recover a fragment from a compromised relay.', cost: '−90 POWER', reward: '+180 ₡', tone: 'pink' }
    ];
    const list = $('#contract-list');
    if (!list) return;
    list.innerHTML = contracts.map((contract, index) => `<article class="contract-card panel"><div class="fleet-icon" style="color:var(--${contract.tone})">${contract.icon}</div><div class="panel-kicker">CONTRACT 0${index + 1}</div><h3>${contract.title}</h3><p>${contract.copy}</p><div class="contract-meta"><span>COST <strong>${contract.cost}</strong></span><span>REWARD <strong>${contract.reward}</strong></span></div><button class="button button-ghost" data-contract="${index}" type="button">Review contract ↗</button></article>`).join('');
  }

  function renderFleet() {
    const list = $('#fleet-list');
    if (!list) return;
    const ships = [
      { icon: '△', name: 'Kestrel Scout', detail: 'Fast recon craft · 1 slot', status: state.scoutReady ? 'READY TO LAUNCH' : 'MISSION ACTIVE', ready: state.scoutReady },
      { icon: '◇', name: 'Morrow Hauler', detail: 'Cargo carrier · 2 slots', status: 'DRYDOCK // 68%', ready: false },
      { icon: '✧', name: 'Unknown Signal', detail: 'Blueprint locked · scan to reveal', status: 'LOCKED', ready: false }
    ];
    list.innerHTML = ships.map((ship, index) => `<article class="fleet-card panel ${ship.ready ? 'is-ready' : ''}"><div class="fleet-icon">${ship.icon}</div><div class="panel-kicker">CRAFT 0${index + 1}</div><h3>${ship.name}</h3><p>${ship.detail}</p><div class="fleet-meta"><span class="fleet-state">${ship.status}</span><span>${index === 0 ? 'RECON' : index === 1 ? 'CARGO' : '???'}</span></div><button class="button ${ship.ready ? 'button-primary' : 'button-ghost'}" data-ship="${index}" type="button" ${ship.ready ? '' : 'disabled'}>${ship.ready ? 'Launch scout ↗' : index === 1 ? 'Unavailable' : 'Locked'}</button></article>`).join('');
  }

  function showView(view) {
    $$('[data-view-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.viewPanel === view));
    $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === view));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function enterDemo(event) {
    event.preventDefault();
    const input = $('#pilot-name');
    const pilot = (input?.value || '').trim().replace(/[^a-zA-Z0-9А-Яа-я_\-. ]/g, '').slice(0, 20);
    if (pilot.length < 2) {
      input?.focus();
      toast('Choose a callsign with at least 2 characters.', 'warn');
      return;
    }
    state = { ...DEFAULT_STATE, pilot, logs: [{ time: 'NOW', text: `Welcome, ${pilot}. Local command node initialized.` }, ...DEFAULT_STATE.logs.slice(1)] };
    persist();
    openApp();
    toast(`Welcome to Outpost Zero, ${pilot}.`);
  }

  function openApp() {
    $('#gate')?.classList.add('is-hidden');
    $('#app')?.classList.remove('is-hidden');
    renderAll();
    startCycle();
  }

  function resetDemo() {
    if (!window.confirm('Reset this local demo and choose a new callsign?')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = { ...DEFAULT_STATE };
    window.location.reload();
  }

  function deployMission() {
    if (state.deployed || state.missionDone || state.power < 100) {
      toast(state.power < 100 ? 'Not enough power for a recon launch.' : 'This mission is already resolved.', 'warn');
      return;
    }
    state.deployed = true;
    state.scoutReady = false;
    state.power -= 100;
    addLog('Kestrel Scout launched toward the silent relay.');
    renderAll();
    toast('Recon launched. Follow the flight trace on the sector map.');
  }

  function chooseStance(stance) {
    if (state.stance === stance) return;
    state.stance = stance;
    const labels = { balanced: 'Balanced protocol engaged: steady output, low heat.', harvest: 'Rapid harvest engaged: more credits, more exposure.', silent: 'Silent running engaged: heat falls, output slows.' };
    addLog(labels[stance]);
    renderStances();
    toast(labels[stance]);
  }

  function reviewContract(index) {
    const contracts = ['Echo Market sweep', 'Ghost convoy escort', 'Black relay extraction'];
    const costs = [60, 35, 90];
    const rewards = [45, 110, 180];
    if (state.power < costs[index]) { toast('Power reserve is too low for this contract.', 'warn'); return; }
    state.power -= costs[index];
    if (index === 0) state.data += rewards[index]; else state.credits += rewards[index];
    state.heat += index === 2 ? 12 : index === 1 ? 5 : 2;
    addLog(`${contracts[index]} completed. The sector learned something about you.`);
    renderAll();
    toast(`${contracts[index]} complete. Rewards secured.`);
  }

  function scanNode(button) {
    const label = button.getAttribute('title') || 'Unknown signal';
    state.data += 8;
    state.heat += label === 'Scan Redline' ? 7 : 1;
    addLog(`Scanned ${label.replace('Scan ', '')}. Signal data recovered.`);
    renderAll();
    toast(`${label.replace('Scan ', '')} scanned: +8 signal data.`);
  }

  function launchFleet(index) {
    if (index !== 0 || !state.scoutReady) return;
    deployMission();
    showView('map');
  }

  function cycle() {
    const modifiers = { balanced: { data: 4, credits: 12, heat: -.3 }, harvest: { data: 5, credits: 17, heat: 1.1 }, silent: { data: 2, credits: 8, heat: -1.2 } };
    const mod = modifiers[state.stance];
    state.power = Math.min(1000, state.power + (state.stance === 'silent' ? 8 : 4));
    state.data += mod.data;
    state.credits += mod.credits;
    state.heat = Math.max(0, Math.min(100, state.heat + mod.heat));
    if (state.deployed && !state.missionDone) {
      state.missionProgress = Math.min(100, state.missionProgress + 14);
      state.heat = Math.min(100, state.heat + .7);
      if (state.missionProgress >= 100) {
        state.missionDone = true;
        state.deployed = false;
        state.scoutReady = false;
        state.data += 80;
        state.credits += 140;
        addLog('Silent relay recovered. The outpost has a new route into the sector.');
        toast('Mission complete: +80 data, +140 credits.');
      }
    }
    if (state.data >= 250 && state.day === 1) {
      state.day = 2;
      addLog('Milestone reached: signal data threshold crossed. Day 02 unlocked.');
      toast('Day 02 unlocked. New contracts will arrive soon.');
    }
    renderResources();
    renderHeader();
    renderFleet();
    persist();
  }

  function startCycle() {
    if (cycleTimer) window.clearInterval(cycleTimer);
    cycleTimer = window.setInterval(cycle, 4000);
  }

  function renderAll() {
    renderHeader();
    renderResources();
    renderActivity();
    renderStances();
    renderOperations();
    renderFleet();
    if (state.deployed && !state.missionDone) $('#flight-trace')?.classList.remove('is-hidden');
  }

  function updateClocks() {
    setText('gate-clock', `${nowTime()} UTC`);
    setText('top-clock', shortTime());
  }

  function bindEvents() {
    $('#demo-entry-form')?.addEventListener('submit', enterDemo);
    $('#reset-demo')?.addEventListener('click', resetDemo);
    $$('.nav-item').forEach((item) => item.addEventListener('click', () => showView(item.dataset.view)));
    $$('.stance').forEach((button) => button.addEventListener('click', () => chooseStance(button.dataset.stance)));
    document.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'deploy') deployMission();
      if (action === 'scan-node') scanNode(event.target.closest('[data-action]'));
      const contract = event.target.closest('[data-contract]')?.dataset.contract;
      if (contract !== undefined) reviewContract(Number(contract));
      const ship = event.target.closest('[data-ship]')?.dataset.ship;
      if (ship !== undefined) launchFleet(Number(ship));
      if (action === 'toggle-log') $('#activity-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function boot() {
    bindEvents();
    updateClocks();
    window.setInterval(updateClocks, 1000);
    if (state.pilot) openApp();
    else $('#pilot-name')?.focus();
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
