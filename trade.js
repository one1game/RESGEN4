import { supabase } from './supabase.js';
import { GameBus, EVENTS } from './game-events.js';
import { escapeHtml } from './utils.js';

const RES_META = {
  coal:   { icon: '🪨', name: 'Уголь' },
  ore:    { icon: '⛏️',  name: 'Руда' },
  chips:  { icon: '🎛️', name: 'Чипы' },
  plasma: { icon: '⚡',  name: 'Плазма' },
  trash:  { icon: '♻️',  name: 'Мусор' },
};

const UNKNOWN_RES = { icon: '📦', name: 'Неизвестно' };

export const tradeModule = {
  game: null,
  currentUserId: null,
  myOffers: [],
  marketOffers: [],
  isLoading: false,
  _pollInterval: null,
  _channel: null,
  _reloadDebounce: null,
  _lastOfferCreatedAt: 0,
  OFFER_COOLDOWN_MS: 8000,

  init(game, userId) {
    this.game = game;
    this.currentUserId = userId;
    this.loadOffers();
    this._subscribeRealtime();
    this.startPolling();
    console.log('🔄 Trade module initialized (realtime)');
  },

  cleanup() {
    this.stopPolling();
    if (this._channel) {
      supabase.removeChannel(this._channel);
      this._channel = null;
    }
    clearTimeout(this._reloadDebounce);
    this.myOffers = [];
    this.marketOffers = [];
    this.game = null;
    this.currentUserId = null;
  },

  startPolling() {
    this.stopPolling();
    this._pollInterval = setInterval(() => this.loadOffers(), 30000);
  },

  stopPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  },

  _subscribeRealtime() {
    if (this._channel) return;
    this._channel = supabase
      .channel('trade_offers_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'trade_offers' },
        () => {
          clearTimeout(this._reloadDebounce);
          this._reloadDebounce = setTimeout(() => this.loadOffers(), 300);
        }
      )
      .subscribe();
  },

  _applyChanges(changes) {
    if (!Array.isArray(changes) || !this.game) return;
    changes.forEach(({ resource, delta }) => {
      if (!delta) return;
      if (delta > 0) {
        this.game.add_resource(resource, delta);
      } else {
        this.game.subtract_resource(resource, -delta);
      }
    });
    if (window.updateInventoryDisplay) {
      try {
        window.updateInventoryDisplay(JSON.parse(this.game.get_statistics()));
      } catch (e) {}
    }
  },

  async loadOffers() {
    if (!this.currentUserId || this.isLoading) return;
    this.isLoading = true;
    try {
      const { data: my } = await supabase
        .from('trade_offers')
        .select('*')
        .eq('seller_id', this.currentUserId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      this.myOffers = my || [];

      const { data: market } = await supabase
        .from('trade_offers')
        .select('*')
        .eq('status', 'active')
        .neq('seller_id', this.currentUserId)
        .order('created_at', { ascending: false })
        .limit(50);
      this.marketOffers = market || [];

      if (this.marketOffers.length > 0) {
        const sellerIds = [...new Set(this.marketOffers.map(o => o.seller_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', sellerIds);
        if (profiles) {
          const nameMap = {};
          profiles.forEach(p => { nameMap[p.id] = p.username; });
          this.marketOffers.forEach(o => { o._sellerName = nameMap[o.seller_id] || 'Игрок'; });
        }
      }

      this._render();
    } catch (e) {
      console.warn('Trade load error:', e);
    } finally {
      this.isLoading = false;
    }
  },

  async createOffer(giveResource, giveAmount, wantResource, wantAmount) {
    if (!this.currentUserId) return { success: false, error: 'Не авторизован' };
    if (!this.game) return { success: false, error: 'Игра не инициализирована' };

    const now = Date.now();
    if (now - this._lastOfferCreatedAt < this.OFFER_COOLDOWN_MS) {
      const waitSec = Math.ceil((this.OFFER_COOLDOWN_MS - (now - this._lastOfferCreatedAt)) / 1000);
      return { success: false, error: `Подождите ${waitSec} сек перед следующим предложением` };
    }

    if (giveAmount <= 0 || wantAmount <= 0) {
      return { success: false, error: 'Неверное количество' };
    }
    if (giveResource === wantResource) {
      return { success: false, error: 'Нельзя обменивать ресурс на себя' };
    }

    let stats = null;
    try {
      stats = JSON.parse(this.game.get_statistics());
    } catch (e) {
      return { success: false, error: 'Ошибка чтения инвентаря' };
    }

    if (stats?.trade_blocked) {
      return { success: false, error: 'Торговля заблокирована (ночная осада)' };
    }

    const have = stats[`${giveResource}_inventory`] || 0;
    if (have < giveAmount) {
      return { success: false, error: `Недостаточно ${(RES_META[giveResource] || UNKNOWN_RES).name} (есть ${have}, нужно ${giveAmount})` };
    }

    try {
      const { data, error } = await supabase.rpc('create_trade_offer', {
        p_seller_id: this.currentUserId,
        p_give_resource: giveResource,
        p_give_amount: giveAmount,
        p_want_resource: wantResource,
        p_want_amount: wantAmount,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object') {
        return { success: false, error: 'Некорректный ответ сервера (пустой ответ RPC)' };
      }
      if (!data?.success) {
        return { success: false, error: data?.error || 'Ошибка создания' };
      }
      this._lastOfferCreatedAt = Date.now();
      this._applyChanges([{ resource: giveResource, delta: -giveAmount }]);
      window.showNotif?.('✅ Предложение создано', false);
      GameBus.emit(EVENTS.TRADE_DONE, { type: 'created' });
      await this.loadOffers();
      return { success: true };
    } catch (e) {
      console.error('Create offer error:', e);
      return { success: false, error: e.message };
    }
  },

  async acceptOffer(tradeId) {
    if (!this.currentUserId) return { success: false, error: 'Не авторизован' };
    if (!this.game) return { success: false, error: 'Игра не инициализирована' };

    let stats = null;
    try { stats = JSON.parse(this.game.get_statistics()); } catch (e) {}
    if (stats?.trade_blocked) {
      window.showNotif?.('🔴 Торговля заблокирована (ночная осада)', true);
      return { success: false, error: 'Торговля заблокирована' };
    }

    try {
      const { data, error } = await supabase.rpc('accept_trade_offer', {
        p_buyer_id: this.currentUserId,
        p_trade_id: tradeId,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object') {
        window.showNotif?.('❌ Некорректный ответ сервера', true);
        return { success: false, error: 'Некорректный ответ сервера (пустой ответ RPC)' };
      }
      if (!data?.success) {
        window.showNotif?.(`❌ ${data?.error || 'Ошибка обмена'}`, true);
        // Авто-обновление рынка при любой ошибке — состояние могло устареть
        await this.loadOffers();
        return { success: false, error: data?.error };
      }
      const receivedRes = RES_META[data.received_resource] || UNKNOWN_RES;
      const paidRes = RES_META[data.paid_resource] || UNKNOWN_RES;
      this._applyChanges([
        { resource: data.received_resource, delta: data.received },
        { resource: data.paid_resource, delta: -(data.paid) }
      ]);
      window.showNotif?.(
        `✅ Обмен завершён: +${data.received}${receivedRes.icon} за -${data.paid}${paidRes.icon}`,
        false
      );
      GameBus.emit(EVENTS.TRADE_DONE, { type: 'accepted', tradeId });
      await this.loadOffers();
      return { success: true };
    } catch (e) {
      console.error('Accept offer error:', e);
      window.showNotif?.(`❌ ${e.message}`, true);
      return { success: false, error: e.message };
    }
  },

  async cancelOffer(tradeId) {
    if (!this.currentUserId) return { success: false, error: 'Не авторизован' };
    try {
      const { data, error } = await supabase.rpc('cancel_trade_offer', {
        p_seller_id: this.currentUserId,
        p_trade_id: tradeId,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object') {
        return { success: false, error: 'Некорректный ответ сервера (пустой ответ RPC)' };
      }
      if (!data?.success) {
        return { success: false, error: data?.error };
      }
      const offer = this.myOffers.find(o => o.id === tradeId);
      if (offer) {
        this._applyChanges([{ resource: offer.give_resource, delta: offer.give_amount }]);
      }
      window.showNotif?.('🔄 Предложение отменено, ресурсы возвращены', false);
      await this.loadOffers();
      return { success: true };
    } catch (e) {
      console.error('Cancel offer error:', e);
      return { success: false, error: e.message };
    }
  },

  _render() {
    if (!this.currentUserId) return;
    const container = document.getElementById('tradeContainer');
    if (!container) return;
    container.innerHTML = this._buildUI();
    this._attachHandlers(container);
  },

  _buildUI() {
    let stats = {};
    if (this.game) {
      try {
        stats = JSON.parse(this.game.get_statistics() || '{}');
      } catch (e) {
        console.warn('Invalid stats JSON in trade _buildUI:', e);
      }
    }
    const inv = {
      coal: stats.coal_inventory || 0,
      ore: stats.ore_inventory || 0,
      chips: stats.chips_inventory || 0,
      plasma: stats.plasma_inventory || 0,
      trash: stats.trash_inventory || 0,
    };

    const resOptions = Object.entries(RES_META)
      .map(([k, v]) => `<option value="${k}">${v.icon} ${v.name}</option>`)
      .join('');

    const myOffersHtml = this.myOffers.length === 0
      ? `<div class="trade-empty">У вас нет активных предложений</div>`
      : this.myOffers.map(o => this._renderMyOffer(o)).join('');

    const marketHtml = this.marketOffers.length === 0
      ? `<div class="trade-empty">Рынок пуст — будьте первым!</div>`
      : this.marketOffers.map(o => this._renderMarketOffer(o, inv)).join('');

    return `
      <div class="trade-p2p">
        <div class="trade-create-panel">
          <div class="trade-create-title">📝 СОЗДАТЬ ПРЕДЛОЖЕНИЕ</div>
          <div class="trade-create-hint">
            Ресурсы будут заморожены в предложении. При краже повстанцами — уменьшатся пропорционально.
            Если количество обмениваемого достигнет 0 — предложение исчезнет.
          </div>
          <div class="trade-create-form">
            <div class="trade-row">
              <label>Даю:</label>
              <select id="trade-give-res">${resOptions}</select>
              <input type="number" id="trade-give-amt" min="1" value="10" />
            </div>
            <div class="trade-row">
              <label>Хочу получить:</label>
              <select id="trade-want-res">${resOptions}</select>
              <input type="number" id="trade-want-amt" min="1" value="10" />
            </div>
            <button id="trade-create-btn" class="trade-create-btn">💱 ВЫСТАВИТЬ НА РЫНОК</button>
          </div>
        </div>

        <div class="trade-section">
          <div class="trade-section-title">📦 МОИ ПРЕДЛОЖЕНИЯ (${this.myOffers.length})</div>
          <div class="trade-grid">${myOffersHtml}</div>
        </div>

        <div class="trade-section">
          <div class="trade-section-title">🌐 РЫНОК (${this.marketOffers.length})</div>
          <div class="trade-grid">${marketHtml}</div>
        </div>
      </div>
    `;
  },

  _renderMyOffer(o) {
    if (!o.id || o.give_amount == null || o.want_amount == null) return '';
    const give = RES_META[o.give_resource] || UNKNOWN_RES;
    const want = RES_META[o.want_resource] || UNKNOWN_RES;
    const age = this._formatAge(o.created_at);
    const rate = o.give_amount > 0
      ? (o.want_amount / o.give_amount).toFixed(2)
      : '—';
    return `
      <div class="trade-card mine" data-trade-id="${o.id || ''}">
        <div class="trade-card-header">
          <span class="trade-age">🕐 ${age}</span>
          <button class="trade-cancel-btn" data-trade-id="${o.id || ''}">❌ ОТМЕНИТЬ</button>
        </div>
        <div class="trade-card-body">
          <div class="trade-side give">
            <div class="trade-side-label">Даю</div>
            <div class="trade-side-value">${give.icon} <b>${o.give_amount || 0}</b> <small>${give.name}</small></div>
          </div>
          <div class="trade-arrow">→</div>
          <div class="trade-side want">
            <div class="trade-side-label">Хочу</div>
            <div class="trade-side-value">${want.icon} <b>${o.want_amount || 0}</b> <small>${want.name}</small></div>
          </div>
        </div>
        <div class="trade-card-footer">
          Курс: 1 ${give.name} = ${rate} ${want.name}
        </div>
      </div>
    `;
  },

  _renderMarketOffer(o, inv) {
    if (!o.id || o.give_amount == null || o.want_amount == null) return '';
    const give = RES_META[o.give_resource] || UNKNOWN_RES;
    const want = RES_META[o.want_resource] || UNKNOWN_RES;
    const age = this._formatAge(o.created_at);
    const sellerName = escapeHtml(o._sellerName || 'Игрок');
    const canAfford = (inv[o.want_resource] || 0) >= (o.want_amount || 0);
    const have = inv[o.want_resource] || 0;
    const rate = o.give_amount > 0
      ? (o.want_amount / o.give_amount).toFixed(2)
      : '—';
    return `
      <div class="trade-card market ${canAfford ? '' : 'locked'}" data-trade-id="${o.id || ''}">
        <div class="trade-card-header">
          <span class="trade-seller">👤 ${sellerName}</span>
          <span class="trade-age">${age}</span>
        </div>
        <div class="trade-card-body">
          <div class="trade-side give">
            <div class="trade-side-label">Отдаёт</div>
            <div class="trade-side-value">${give.icon} <b>${o.give_amount || 0}</b> <small>${give.name}</small></div>
          </div>
          <div class="trade-arrow">→</div>
          <div class="trade-side want">
            <div class="trade-side-label">Хочет</div>
            <div class="trade-side-value">${want.icon} <b>${o.want_amount || 0}</b> <small>${want.name}</small></div>
          </div>
        </div>
        <div class="trade-card-footer">
          <div>Курс: 1 ${give.name} = ${rate} ${want.name}</div>
          <div class="trade-have">У вас: ${have} ${want.icon} ${want.name}</div>
        </div>
        <button class="trade-accept-btn" data-trade-id="${o.id || ''}" ${canAfford ? '' : 'disabled'}>
          ${canAfford ? '✅ ОБМЕНЯТЬ' : '🔒 НЕДОСТАТОЧНО'}
        </button>
      </div>
    `;
  },

  _formatAge(iso) {
    const timestamp = new Date(iso).getTime();
    if (isNaN(timestamp)) return 'неизвестно';
    const mins = Math.floor((Date.now() - timestamp) / 60000);
    if (mins < 0) return 'только что';
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h} ч`;
    return `${Math.floor(h / 24)} д`;
  },

  _attachHandlers(container) {
    const createBtn = container.querySelector('#trade-create-btn');
    if (createBtn) {
      createBtn.onclick = async () => {
        if (createBtn.disabled) return;
        createBtn.disabled = true;
        try {
          const giveRes = container.querySelector('#trade-give-res').value;
          const giveAmt = parseInt(container.querySelector('#trade-give-amt').value) || 0;
          const wantRes = container.querySelector('#trade-want-res').value;
          const wantAmt = parseInt(container.querySelector('#trade-want-amt').value) || 0;
          const result = await this.createOffer(giveRes, giveAmt, wantRes, wantAmt);
          if (!result.success) window.showNotif?.(`❌ ${result.error}`, true);
        } finally {
          createBtn.disabled = false;
        }
      };
    }

    container.querySelectorAll('.trade-cancel-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Отменить предложение? Ресурсы вернутся в инвентарь.')) return;
        btn.disabled = true;
        try {
          await this.cancelOffer(btn.dataset.tradeId);
        } finally {
          btn.disabled = false;
        }
      };
    });

    container.querySelectorAll('.trade-accept-btn').forEach(btn => {
      btn.onclick = async () => {
        if (btn.disabled) return;
        if (!confirm('Принять предложение? Ресурсы будут обменены.')) return;
        btn.disabled = true;
        try {
          await this.acceptOffer(btn.dataset.tradeId);
        } finally {
          btn.disabled = false;
        }
      };
    });
  },
};

window.tradeModule = tradeModule;
export default tradeModule;
