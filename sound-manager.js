import { Sounds } from './sounds.js';

class SoundManager {
    constructor() {
        this.queue = [];
        this.active = 0;
        this.maxConcurrent = 6;
        this.history = [];
        this.maxHistory = 50;
        this._isDestroyed = false;
    }

    async play(name, opts = {}) {
        if (this._isDestroyed) return;
        if (Sounds.isMuted?.()) return;
        if (!Sounds[name]) {
            console.warn(`Sound "${name}" not found`);
            return;
        }
        if (this.active >= this.maxConcurrent) {
            this.queue.push({ name, opts, timestamp: Date.now() });
            if (this.queue.length > 20) this.queue.shift();
            return;
        }
        this.active++;
        const startTime = Date.now();
        try {
            await Sounds[name](opts);
            this.history.push({ name, duration: Date.now() - startTime, timestamp: startTime });
            if (this.history.length > this.maxHistory) this.history.shift();
        } catch(e) {
            console.warn(`Sound "${name}" failed:`, e);
        } finally {
            this.active--;
            this.processQueue();
        }
    }

    processQueue() {
        if (this._isDestroyed) return;
        if (this.queue.length > 0 && this.active < this.maxConcurrent) {
            const next = this.queue.shift();
            this.play(next.name, next.opts);
        }
    }

    stopAll() {
        this.queue = [];
    }

    destroy() {
        this._isDestroyed = true;
        this.queue = [];
        this.active = 0;
        Sounds.destroy?.();
    }

    getStats() {
        return {
            active: this.active,
            queued: this.queue.length,
            history: this.history.slice(-10)
        };
    }
}

export const soundManager = new SoundManager();
window.soundManager = soundManager;