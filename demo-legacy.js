(() => {
  'use strict';

  const SAVE_KEY = 'corebox_public_demo_v2';
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { const node = $(id); if (node) node.textContent = value; };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const fmt = (value) => Math.floor(value).toLocaleString('en-US');

  const defaultState = {
    pilot: '', day: 1, power: 620, maxPower: 1000, clicks: 0, sync: 0,
    coal: 18, trash: 34, plasma: 9, ore: 5, credits: 260,
    heat: 14, neuro: 18, neuroLevel: 1, miningLevel: 1,
    stance: 'balanced', coalOn: true, defenseOn: false, autoOn: false,
    mission: 0, scanned: 0, upgrades: {}, crafted: 0, ships: 1,
    route: false, zoom: 1, log: ['[DEMO] Local command node initialized.', '[DEMO] No account service or production data connected.']
  };

  let state = loadState();
  let tickTimer = null;
  let mineTimer = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      return saved ? { ...defaultState, ...saved } : { ...defaultState };
    } catch (_) {
      return { ...defaultState };
    }
  }

  function save(message = 'LOCAL SAVE') {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    const indicator = $('saveIndicator');
    if (indicator) {
      indicator.textContent = message;
      indicator.style.opacity = '1';
      window.setTimeout(() => { indicator.style.opacity = '0'; }, 1100);
    }
  }

  function log(message) {
    state.log.unshift(`[${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] ${message}`);
    state.log = state.log.slice(0, 32);
    const box = $('logBox');
    if (box) box.innerHTML = state.log.map((entry) => `<div>${escapeHtml(entry)}</div>`).join('');
    const fleetLog = $('demoFleetLog');
    if (fleetLog) fleetLog.innerHTML = state.log.slice(0, 5).map((entry) => `<div class="fleet-log-entry">${escapeHtml(entry)}</div>`).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function showDemo() {
    const gate = $('demoGate');
    const game = $('gameContent');
    if (gate) gate.style.display = 'none';
    if (game) game.style.display = 'block';
    state.pilot = state.pilot || 'Nightwatch';
    text('usernameDisplay', `${state.pilot.toUpperCase()} // DEMO`);
    const header = document.querySelector('.header h1');
    if (header && !header.querySelector('.demo-build-label')) {
      header.insertAdjacentHTML('beforeend', ' <span class="demo-build-label">| PUBLIC DEMO</span>');
    }
    renderAll();
    save('DEMO READY');
    startClock();
  }

  function hideDemo() {
    if ($('gameContent')) $('gameContent').style.display = 'none';
    if ($('demoGate')) $('demoGate').style.display = 'flex';
    if ($('demoCallsign')) $('demoCallsign').value = '';
    window.clearInterval(tickTimer);
  }

  function startClock() {
    window.clearInterval(tickTimer);
    tickTimer = window.setInterval(() => {
      if (!state.pilot) return;
      const powerRate = state.coalOn ? 3 : 1;
      state.power = clamp(state.power + powerRate, 0, state.maxPower);
      state.credits += state.stance === 'harvest' ? 2 : 1;
      state.heat = clamp(state.heat + (state.stance === 'harvest' ? 0.9 : state.coalOn ? 0.2 : -0.8), 0, 100);
      if (state.heat >= 72 && state.stance === 'harvest') log('Heat limit approaching. Consider Silent Protocol.');
      renderCore();
      if (state.route) drawMap();
    }, 1000);
  }

  function renderAll() {
    renderCore();
    renderStats();
    renderResources();
    renderUpgrades();
    renderTrade();
    renderQuests();
    renderCommand();
    renderCraft();
    renderDesign();
    renderFleet();
    renderSpace();
    renderLog();
  }

  function renderCore() {
    const powerPct = (state.power / state.maxPower) * 100;
    text('timeDisplay', `DAY ${String(state.day).padStart(2, '0')} // ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    text('coalStatus', state.coalOn ? 'ONLINE' : 'OFFLINE');
    text('coalStatusDisplay', state.coalOn ? 'ONLINE' : 'OFFLINE');
    text('aiStatusText', state.autoOn ? 'ACTIVE' : 'STANDBY');
    text('defenseStatusText', state.defenseOn ? 'ACTIVE' : 'STANDBY');
    text('rebelStatus', state.heat > 55 ? 'ELEVATED' : 'LOW LEVEL');
    text('turbineHeatLabel', `${Math.round(state.heat)}%`);
    text('neuroStatusShort', `${Math.round(state.neuro)}% (LV.${state.neuroLevel})`);
    text('aiMode', state.stance === 'harvest' ? '↯ Rapid Harvest' : state.stance === 'silent' ? '⌁ Silent Running' : '⚙ Balanced');
    text('coalInventoryAmount', fmt(state.coal));
    text('tecPowerBonus', state.coalOn ? '+12' : '+0');
    text('powerText', `${fmt(state.power)}/${fmt(state.maxPower)}`);
    text('powerTier', `Tier ${state.miningLevel} | +${state.miningLevel} power/click`);
    text('powerRecoveryStatus', state.coalOn ? 'Power: recovering from local TEC node' : 'Power: manual recovery only — TEC offline');
    text('clickProgressText', `${state.sync}/10`);
    text('autoClickStatus', state.autoOn ? 'ACTIVE' : 'DISABLED');
    text('powerPerClick', state.miningLevel);
    text('autoClickInterval', state.autoOn ? '3' : '5');
    text('autoClickCost', state.autoOn ? '2' : '1');
    const bar = $('powerFill'); if (bar) bar.style.width = `${powerPct}%`;
    const heatBar = $('turbineHeatBar'); if (heatBar) { heatBar.style.width = `${state.heat}%`; heatBar.className = `turbine-fill ${state.heat > 70 ? 'turbine-hot' : 'turbine-cool'}`; }
    const neuroBar = $('neuroProgress'); if (neuroBar) neuroBar.style.width = `${state.neuro}%`;
    const syncBar = $('clickProgress'); if (syncBar) syncBar.style.width = `${state.sync * 10}%`;
    const tecDot = $('tec-dot'); if (tecDot) tecDot.className = `tec-dot ${state.coalOn ? 'online' : 'offline'}`;
    const coalDot = $('coal-dot'); if (coalDot) coalDot.className = `sys-dot ${state.coalOn ? 'online' : 'offline'}`;
    const autoBtn = $('floatingMineBtn'); if (autoBtn) autoBtn.classList.toggle('auto-clicking', state.autoOn);
  }

  function renderStats() {
    const values = {
      totalClicks: state.clicks, maxPowerReached: state.maxPower, nightsSurvived: Math.max(0, state.day - 1),
      totalMined: state.clicks * state.miningLevel, neuroEvolution: state.neuroLevel,
      neuroConsciousness: `${Math.round(state.neuro)}%`, neuroScore: state.neuro * 10,
      currentAiMode: state.stance, rebelAttacks: Math.floor(state.heat / 35), attacksDefended: state.defenseOn ? 2 : 0,
      rebelActivity: Math.round(state.heat), visibility: Math.round(state.heat), consecutiveDefenses: state.defenseOn ? 2 : 0,
      coalMined: state.coal, trashMined: state.trash, plasmaMined: state.plasma, oreMined: state.ore,
      coalBurned: Math.max(0, 18 - state.coal), coalStolen: 0, playTime: `${Math.max(1, state.clicks)} sec`, sessionsCount: 1,
      fleetShips: `${state.ships}/20`, fleetCombatPower: state.ships * 120, blueprintsUnlocked: `${state.ships > 1 ? 2 : 1}/3`, miningLevel: state.miningLevel
    };
    Object.entries(values).forEach(([id, value]) => text(id, fmtValue(value)));
  }

  function fmtValue(value) { return typeof value === 'number' ? fmt(value) : value; }

  function renderResources() {
    const host = $('resourcesContainer'); if (!host) return;
    const rows = [
      ['⚡', 'Computational power', state.power, state.maxPower, 'power'],
      ['◈', 'Coal reserve', state.coal, 'TEC fuel', 'coal'],
      ['▧', 'Recovered scrap', state.trash, 'crafting stock', 'trash'],
      ['✦', 'Plasma cells', state.plasma, 'rare energy', 'plasma'],
      ['◆', 'Refined ore', state.ore, 'module alloy', 'ore'],
      ['₡', 'Black credits', state.credits, 'local exchange', 'credits']
    ];
    host.innerHTML = `<div class="demo-resource-grid">${rows.map(([icon, name, value, hint, key]) => `<div class="resource-card"><div class="resource-icon">${icon}</div><div class="resource-info"><div class="resource-name">${name}</div><div class="resource-value" data-resource="${key}">${fmt(value)}${key === 'power' ? ` / ${fmt(hint)}` : ''}</div><div class="resource-hint">${key === 'power' ? 'reserve ceiling' : hint}</div></div></div>`).join('')}</div><div class="demo-inline-note">Local demo economy is intentionally capped for a short evaluation session.</div>`;
  }

  function renderUpgrades() {
    const host = $('upgradesContainer'); if (!host) return;
    const items = [
      ['thermal-core', 'Thermal Core', 'Reduce heat from every cycle.', 90, '−8% heat'],
      ['signal-lens', 'Signal Lens', 'Improve scan yield on the sector map.', 140, '+4 data'],
      ['cargo-frame', 'Cargo Frame', 'Increase expedition and crafting capacity.', 200, '+1 slot']
    ];
    host.innerHTML = items.map(([id, name, desc, cost, effect]) => { const active = !!state.upgrades[id]; return `<div class="upgrade-card"><div class="upgrade-header"><span class="upgrade-title">${name}</span><span class="upgrade-level">${active ? 'LV. 01' : 'LOCKED'}</span></div><div class="demo-card-copy">${desc}</div><div class="requirement"><span class="requirement-name">₡ Cost</span><span class="requirement-value">${cost}</span></div><div class="requirement"><span class="requirement-name">Effect</span><span class="requirement-value">${effect}</span></div><button class="upgrade-btn ${active ? 'activated' : ''}" data-demo-action="upgrade" data-upgrade="${id}" data-cost="${cost}" ${active || state.credits < cost ? 'disabled' : ''}>${active ? 'ACTIVATED' : 'INSTALL MODULE'}</button></div>`; }).join('');
  }

  function renderTrade() {
    const host = $('tradeContainer'); if (!host) return;
    const offers = [['40 coal', '8 credits', 'coal', 40, 'credits', 8], ['12 scrap', '1 plasma', 'trash', 12, 'plasma', 1], ['2 ore', '24 credits', 'ore', 2, 'credits', 24]];
    host.innerHTML = `<div class="trade-container"><div class="trade-mode-toggle"><button class="trade-mode-btn active" type="button">LOCAL EXCHANGE</button><button class="trade-mode-btn" type="button" disabled>ASYNC P2P // DEMO</button></div><div class="trade-items-grid">${offers.map(([from, to, fromKey, amount, toKey, reward]) => `<div class="trade-card"><div class="trade-from">${from}</div><div class="trade-arr">↓</div><div class="trade-to">${to}</div><div class="trade-have">Available: ${fmt(state[fromKey])}</div><button class="trade-btn" data-demo-action="trade" data-from="${fromKey}" data-amount="${amount}" data-to="${toKey}" data-reward="${reward}" ${state[fromKey] < amount ? 'disabled' : ''}>EXECUTE SWAP</button></div>`).join('')}</div><div class="demo-inline-note">The online market is intentionally disconnected in this public build.</div></div>`;
  }

  function renderQuests() {
    const host = $('questsContainer'); if (!host) return;
    const missionDone = state.mission > 0;
    const quests = [
      ['quest-active', 'Recover the silent relay', missionDone ? 'COMPLETED' : 'ACTIVE', 'Launch a scout from the Fleet tab and trace the signal on the map.', missionDone ? 100 : 38],
      [state.scanned >= 2 ? 'quest-done' : 'quest-active', 'Map the quiet belt', state.scanned >= 2 ? 'COMPLETED' : 'ACTIVE', 'Scan two points of interest in the spiral sector.', Math.min(100, state.scanned * 50)],
      ['quest-locked', 'Open the black archive', 'LOCKED', 'Reach 250 signal data in the full CoreBox build.', 0]
    ];
    host.innerHTML = quests.map(([cls, title, status, desc, progress]) => `<div class="quest-card ${cls}"><div class="quest-header"><span class="quest-title">${title}</span><span class="quest-status ${status === 'COMPLETED' ? 'status-done' : status === 'LOCKED' ? 'status-locked' : 'status-active'}">${status}</span></div><div class="quest-description">${desc}</div><div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${progress}%"></div></div><div class="quest-progress-text">${progress}% // NEXT SIGNAL</div><div class="quest-reward-hint">Reward preview: +data, +credits, sector mastery</div></div>`).join('');
  }

  function renderCommand() {
    const host = $('corebox-ops-deck-host'); if (!host) return;
    host.innerHTML = `<div class="demo-ops-deck"><div class="cc-sec-label">PUBLIC DEMO OPERATIONS DECK</div><div class="demo-op-grid"><button class="op-btn cc-op-active" data-demo-action="stance" data-stance="balanced">⚙ Balanced protocol <small>steady output / low heat</small></button><button class="op-btn" data-demo-action="stance" data-stance="harvest">↯ Rapid harvest <small>more credits / more heat</small></button><button class="op-btn" data-demo-action="stance" data-stance="silent">⌁ Silent running <small>cooldown / lower output</small></button></div><div class="demo-inline-note">Choose an operational stance, then use Fleet and Sector Map to create a visible flight trace.</div></div>`;
    text('cc-evol', `LV.${state.neuroLevel}`); text('cc-consc', Math.round(state.neuro)); text('cc-score', state.neuro * 10); text('cc-score-next', 'next +10'); text('cc-def-bonus', state.defenseOn ? '+12%' : '+0%'); text('cc-aimode', state.stance); text('cc-rebel-badge', `${Math.round(state.heat)}/100`); text('cc-vuln', state.heat > 65 ? 'HIGH' : 'LOW'); text('cc-prot-status', state.defenseOn ? 'active' : 'standby'); text('cc-defended', state.defenseOn ? 2 : 0); text('cc-total-attacks', Math.floor(state.heat / 35)); text('cc-nights', Math.max(0, state.day - 1)); text('cc-score-total', state.neuro * 10);
  }

  function renderCraft() {
    const host = $('craftContainer'); if (!host) return;
    host.innerHTML = `<div class="craft-compact"><div class="craft-header"><span>FIELD FABRICATION</span><span class="system-offline-badge">LOCAL SIM</span></div><div class="craft-grid"><div class="recipe-card available"><strong>Signal capacitor</strong><div class="demo-recipe">▧ 8 scrap + ✦ 2 plasma → ◈ +60 power</div><button class="craft-btn" data-demo-action="craft" data-cost="8" data-reward="60">CRAFT COMPONENT</button></div><div class="recipe-card"><strong>Scout repair kit</strong><div class="demo-recipe">◆ 2 ore + ▧ 12 scrap → fleet readiness</div><button class="craft-btn" data-demo-action="repair" ${state.ore < 2 || state.trash < 12 ? 'disabled' : ''}>PREPARE KIT</button></div></div><div class="craft-footer"><div class="craft-hint">Crafting is a preview slice of the full resource ecosystem.</div><div class="resource-summary">Scrap ${fmt(state.trash)} // Plasma ${fmt(state.plasma)} // Ore ${fmt(state.ore)}</div></div></div>`;
  }

  function renderDesign() {
    const host = $('designContainer'); if (!host) return;
    host.innerHTML = `<div class="design-compact"><div class="design-header"><span>SHIP BLUEPRINT LAB</span><span class="system-offline-badge">1 / 3 UNLOCKED</span></div><div class="design-grid"><div class="blueprint-card"><strong>Kestrel Scout</strong><div class="demo-card-copy">Fast recon craft // 1 slot // flight trace enabled</div><div class="power-display">⚡ Build power <b>180</b></div><button class="design-btn" data-demo-action="blueprint" ${state.credits < 180 ? 'disabled' : ''}>RESEARCH BLUEPRINT</button></div><div class="blueprint-card"><strong>Morrow Hauler</strong><div class="demo-card-copy">Cargo carrier // 2 slots // blueprint fragment required</div><div class="status-locked">LOCKED // FULL BUILD</div></div></div><div class="design-footer"><span class="design-hint">Research creates new strategic routes.</span><span class="blueprint-summary">Credits ${fmt(state.credits)}</span></div></div>`;
  }

  function renderFleet() {
    const host = $('fleetContainer'); if (!host) return;
    host.innerHTML = `<div class="fleet-container"><div class="fleet-header"><span>FLEET READINESS</span><b>${state.ships} / 3 operational craft</b><span class="fleet-stats">Combat power ${state.ships * 120} // slots ${state.ships}/4</span></div><div class="fleet-summary"><div class="summary-item"><span>Operational</span><span>${state.ships}</span></div><div class="summary-item"><span>On mission</span><span>${state.route ? 1 : 0}</span></div><div class="summary-item"><span>Blueprints</span><span>${state.ships > 1 ? 2 : 1}/3</span></div></div><div class="fleet-grid"><div class="ship-card ${state.route ? 'alert-mode on-mission' : 'defense-mode'}"><div class="ship-header"><span class="ship-icon">△</span><span class="ship-name">Kestrel Scout</span><span class="ship-level">LV. 01</span><span class="ship-status ready">${state.route ? 'ON MISSION' : 'READY'}</span></div><div class="ship-body"><div class="ship-hp"><span class="hp-label">HP</span><span class="hp-value">${state.route ? '88' : '100'} / 100</span><div class="health-bar"><div style="width:${state.route ? 88 : 100}%"></div></div></div><div class="ship-attrs"><span>◈ Speed 92</span><span>✦ Scan 68</span><span>₡ Cost 40</span></div><div class="ship-actions"><button class="ship-btn info-btn" data-demo-action="fleet-info">DETAILS</button><button class="ship-btn defense-btn" data-demo-action="deploy" ${state.route ? 'disabled' : ''}>${state.route ? 'IN FLIGHT' : 'LAUNCH SCOUT'}</button></div></div></div><div class="ship-card"><div class="ship-header"><span class="ship-icon">◇</span><span class="ship-name">Morrow Hauler</span><span class="ship-level">LV. 00</span><span class="ship-status">DRYDOCK</span></div><div class="ship-body"><div class="ship-hp"><span class="hp-label">HP</span><span class="hp-value">68 / 100</span><div class="health-bar"><div style="width:68%"></div></div></div><div class="ship-attrs"><span>▧ Cargo 2</span><span>◈ Speed 38</span></div><div class="ship-actions"><button class="ship-btn repair-btn" data-demo-action="repair" ${state.trash < 12 ? 'disabled' : ''}>REPAIR 12 SCRAP</button></div></div></div></div><div class="fleet-log-compact"><div class="fleet-log-hdr"><span>LOCAL FLEET LOG</span><span>SAFE MODE</span></div><div id="demoFleetLog" class="fleet-log-box"></div></div></div>`;
    log('Fleet control synchronized with local demo state.');
  }

  function renderSpace() {
    text('space-online-count', '2,000 traces // demo'); text('space-power-current', state.power); text('space-power-max', state.maxPower); text('space-ships-count', state.ships); text('space-flight-status', state.route ? '🚀 Active scout flight trace' : '🚀 No active flights');
    const players = $('space-players-list');
    if (players) players.innerHTML = ['ALPHA // neutral relay', 'BETA // convoy signal', 'GAMMA // rival trace', 'DELTA // quiet belt'].map((name, index) => `<div class="space-player-row demo-space-row"><span>${index % 2 ? '◇' : '✦'}</span><span>${name}</span><span class="demo-row-status">${index === 2 ? 'WATCHING' : 'ONLINE'}</span></div>`).join('');
    drawMap();
  }

  function drawMap() {
    const map = $('space-star-map'); if (!map) return;
    const canvas = $('space-main-canvas');
    if (canvas) {
      const rect = map.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width || 640)); const height = Math.max(260, Math.floor(rect.height || 320));
      canvas.width = width * 2; canvas.height = height * 2; canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d'); ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(74,255,157,.16)'; ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.ellipse(width / 2, height / 2, i * width / 12, i * height / 12, -0.16, 0, Math.PI * 2); ctx.stroke(); }
      if (state.route) { ctx.strokeStyle = 'rgba(74,255,157,.78)'; ctx.shadowColor = '#4aff9d'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.moveTo(width / 2, height / 2); ctx.lineTo(width * .78, height * .27); ctx.stroke(); ctx.shadowBlur = 0; }
    }
    const layer = $('space-objects-layer');
    if (layer) {
      layer.style.display = 'block'; layer.innerHTML = '';
      const points = [['ECHO MARKET', 18, 30, 'signal'], ['RELAY 09', 74, 23, 'signal'], ['REDLINE', 82, 71, 'danger'], ['QUIET BELT', 20, 79, 'signal']];
      points.forEach(([name, left, top, kind]) => { const node = document.createElement('button'); node.type = 'button'; node.className = `demo-space-marker ${kind}`; node.style.left = `${left}%`; node.style.top = `${top}%`; node.textContent = `✦ ${name}`; node.addEventListener('click', () => scan(name)); layer.appendChild(node); });
      const base = document.createElement('div'); base.className = 'demo-base-marker'; base.style.left = '50%'; base.style.top = '50%'; base.textContent = '◆ OUTPOST ZERO'; layer.appendChild(base);
    }
    text('space-coordinates', `🗺️ 5000×5000 📍 ${state.route ? 'SCOUT TRACE ACTIVE' : 'OUTPOST ZERO'} 🔍 ${state.scanned} scans`);
  }

  function renderLog() { log(''); state.log.shift(); }

  function mine() {
    if (state.power < 1) { log('Power reserve empty. Wait for local recovery.'); renderCore(); return; }
    state.power = clamp(state.power - 1 + state.miningLevel, 0, state.maxPower);
    state.clicks += 1; state.sync = (state.sync + 1) % 11; state.trash += 1;
    if (state.sync === 0) { state.credits += 6; state.neuro = clamp(state.neuro + 1, 0, 100); log('Synchronization pulse complete: +6 credits.'); }
    renderCore(); renderStats(); renderResources(); save();
  }

  function deploy() {
    if (state.route) return;
    if (state.power < 40) { log('Scout launch blocked: minimum 40 power required.'); return; }
    state.power -= 40; state.route = true; state.mission = 1; state.heat = clamp(state.heat + 6, 0, 100); log('Kestrel Scout launched. Follow the trace on Sector Map.');
    renderAll(); save('SCOUT DEPLOYED');
    window.setTimeout(() => { if (state.route) { state.route = false; state.credits += 40; state.scanned += 1; log('Scout returned: +40 credits and a clean signal sample.'); renderAll(); save('SCOUT RETURNED'); } }, 12000);
  }

  function scan(name) {
    if (state.power < 20) { log(`Scan blocked at ${name}: reserve 20 power first.`); return; }
    state.power -= 20; state.scanned += 1; state.neuro = clamp(state.neuro + 2, 0, 100); state.credits += 8; log(`${name} scanned: +8 credits and +2 neural signal.`); renderAll(); save('SECTOR SCANNED');
  }

  function handleAction(button) {
    const action = button.dataset.demoAction;
    if (action === 'deploy') deploy();
    if (action === 'mine') mine();
    if (action === 'scan') scan(button.dataset.name || 'Relay');
    if (action === 'stance') { state.stance = button.dataset.stance; state.heat = clamp(state.heat + (state.stance === 'harvest' ? 8 : state.stance === 'silent' ? -8 : 0), 0, 100); log(`Operational stance changed to ${state.stance}.`); renderAll(); save('STANCE UPDATED'); }
    if (action === 'upgrade') { const cost = Number(button.dataset.cost); if (state.credits >= cost) { state.credits -= cost; state.upgrades[button.dataset.upgrade] = true; state.miningLevel += 1; log(`Module installed: ${button.dataset.upgrade}.`); renderAll(); save('MODULE INSTALLED'); } }
    if (action === 'trade') { const amount = Number(button.dataset.amount); const reward = Number(button.dataset.reward); const from = button.dataset.from; const to = button.dataset.to; if (state[from] >= amount) { state[from] -= amount; state[to] += reward; log(`Local exchange completed: ${amount} ${from} → ${reward} ${to}.`); renderAll(); save('TRADE COMPLETE'); } }
    if (action === 'craft') { if (state.trash >= 8 && state.plasma >= 2) { state.trash -= 8; state.plasma -= 2; state.power = clamp(state.power + 60, 0, state.maxPower); state.crafted += 1; log('Signal capacitor crafted: +60 power.'); renderAll(); save('COMPONENT CRAFTED'); } }
    if (action === 'repair') { if (state.trash >= 12) { state.trash -= 12; state.ships = Math.max(1, state.ships); log('Scout repair kit prepared. Hauler recovery accelerated.'); renderAll(); save('FLEET REPAIRED'); } }
    if (action === 'blueprint') { if (state.credits >= 180) { state.credits -= 180; state.ships = 2; log('Morrow Hauler blueprint fragment recovered.'); renderAll(); save('BLUEPRINT UNLOCKED'); } }
    if (action === 'fleet-info') log('Kestrel Scout: fast recon craft, one slot, low heat exposure.');
  }

  function bind() {
    const form = $('demoGateForm'); if (form) form.addEventListener('submit', (event) => { event.preventDefault(); const name = ($('demoCallsign')?.value || '').trim(); if (name.length < 2) return; state.pilot = name; save(); showDemo(); });
    document.addEventListener('click', (event) => { const button = event.target.closest('[data-demo-action]'); if (button && !button.disabled) handleAction(button); });
    const mineButton = $('floatingMineBtn');
    if (mineButton) { mineButton.dataset.demoAction = 'mine'; mineButton.addEventListener('pointerdown', () => { mine(); window.clearInterval(mineTimer); mineTimer = window.setInterval(mine, 180); }); ['pointerup', 'pointercancel', 'pointerleave'].forEach((eventName) => mineButton.addEventListener(eventName, () => window.clearInterval(mineTimer))); }
    const tec = $('tec-toggle-btn'); if (tec) tec.addEventListener('click', () => { state.coalOn = !state.coalOn; log(`TEC is now ${state.coalOn ? 'online' : 'offline'}.`); renderAll(); save('TEC UPDATED'); });
    const mute = $('muteToggleBtn'); if (mute) mute.addEventListener('click', () => { mute.textContent = mute.textContent.includes('🔊') ? '🔇' : '🔊'; });
    const logout = $('logoutBtn'); if (logout) logout.addEventListener('click', () => { state.pilot = ''; save(); hideDemo(); });
    const reset = $('resetStatsBtn'); if (reset) reset.addEventListener('click', () => { if (window.confirm('Reset local demo statistics?')) { state = { ...defaultState, pilot: state.pilot }; renderAll(); save('STATISTICS RESET'); } });
    document.querySelectorAll('.status-tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.status-tab').forEach((item) => item.classList.remove('active')); tab.classList.add('active'); const target = tab.id === 'statistics-tab' ? 'statistics' : tab.id === 'leaderboard-tab' ? 'leaderboard' : 'system-status'; document.querySelectorAll('.status-section').forEach((section) => { section.style.display = section.id === `${target}-section` ? 'block' : 'none'; }); }));
    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { const name = tab.dataset.tab; document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab)); document.querySelectorAll('.tab-content').forEach((content) => content.classList.toggle('active', content.id === `${name}-tab`)); }));
    document.querySelectorAll('.panel-title').forEach((title) => title.addEventListener('click', () => title.closest('.panel')?.classList.toggle('collapsed')));
    const clearLog = $('clearLogBtn'); if (clearLog) clearLog.addEventListener('click', () => { state.log = []; renderLog(); save('LOG CLEARED'); });
    const zoomIn = $('map-zoom-in'); if (zoomIn) zoomIn.addEventListener('click', () => { state.zoom = clamp(state.zoom + .1, .8, 1.6); drawMap(); });
    const zoomOut = $('map-zoom-out'); if (zoomOut) zoomOut.addEventListener('click', () => { state.zoom = clamp(state.zoom - .1, .8, 1.6); drawMap(); });
    const zoomReset = $('map-zoom-reset'); if (zoomReset) zoomReset.addEventListener('click', () => { state.zoom = 1; drawMap(); });
    const research = $('space-research-btn'); if (research) research.addEventListener('click', () => scan('Planetary archive'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    if (state.pilot) showDemo();
  });
})();
