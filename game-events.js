export const GameBus = {
    _listeners: {},

    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);

        return () => this.off(event, callback);
    },

    off(event, callback) {
        if (!this._listeners[event]) return;
        if (callback) {
            this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
        } else {

            delete this._listeners[event];
        }
    },

    emit(event, data) {
        (this._listeners[event] || []).forEach(cb => {
            try { cb(data); } catch(e) { console.error(`GameBus error [${event}]:`, e); }
        });
    },

    clear() {
        this._listeners = {};
    },

    clearEvent(event) {
        delete this._listeners[event];
    }
};

export const EVENTS = {
    STATS_UPDATED:       'stats:updated',
    INVENTORY_CHANGED:   'inventory:changed',
    DAY_STARTED:         'time:day',
    NIGHT_STARTED:       'time:night',
    REBEL_ATTACK:        'rebels:attack',
    REBEL_DEFENDED:      'rebels:defended',
    REBEL_ACTIVITY:      'rebels:activity',
    SHIP_MISSION_START:  'fleet:mission:start',
    SHIP_MISSION_END:    'fleet:mission:end',
    FLEET_UPDATED:       'fleet:updated',
    PLANET_ADDED:        'space:planet:added',
    PLANET_MISSION_DONE: 'space:mission:done',
    CLOUD_SAVE_DONE:     'save:cloud:done',
    CLOUD_LOAD_DONE:     'save:cloud:loaded',
    QUEST_COMPLETED:     'quest:completed',
    QUEST_UNLOCKED:      'quest:unlocked',
    CRAFT_DONE:          'craft:done',
    TRADE_DONE:          'trade:done',
    LOGOUT:              'auth:logout',
};

window.GameBus = GameBus;
window.GAME_EVENTS = EVENTS;