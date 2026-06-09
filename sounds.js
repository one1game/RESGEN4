// sounds.js — ПОЛНАЯ ВЕРСИЯ СО ВСЕМИ ЗВУКАМИ ДЛЯ КНОПОК
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let isAudioEnabled = true;
const MASTER_VOLUME = 0.6;

async function getAudioCtx() {
    if (!isAudioEnabled) return null;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    return audioCtx;
}

async function playModernTone({ frequency = 440, type = 'sine', duration = 0.15, volume = 0.3, attack = 0.02, decay = 0.1, sustain = 0.3, freqEnd = null, filterFreq = 2000, filterQ = 1, detune = 0 } = {}) {
    try {
        const ctx = await getAudioCtx();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        osc.detune.setValueAtTime(detune, ctx.currentTime);
        if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + duration);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(filterFreq, ctx.currentTime);
        filter.Q.value = filterQ;
        const finalVolume = volume * MASTER_VOLUME;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(finalVolume, ctx.currentTime + attack);
        gain.gain.exponentialRampToValueAtTime(finalVolume * sustain, ctx.currentTime + attack + decay);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    } catch(e) {}
}

async function playSpaceNoise({ duration = 0.5, volume = 0.1, filterFreq = 200, type = 'pink' } = {}) {
    try {
        const ctx = await getAudioCtx();
        if (!ctx) return;
        if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) duration = Math.min(duration, 0.2);
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let lastOut = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            if (type === 'pink') {
                data[i] = (lastOut + (0.02 * white)) / 1.02;
                lastOut = data[i];
                data[i] *= 3.5;
            } else data[i] = white;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = filterFreq;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(volume * MASTER_VOLUME, ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start();
    } catch(e) {}
}

async function playDigitalClick(volume = 0.12) {
    const ctx = await getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.02);
    gain.gain.setValueAtTime(volume * MASTER_VOLUME, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.02);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.02);
}

// НОВЫЕ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
async function playSoftClickInternal(volume = 0.08) {
    const ctx = await getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.015);
    gain.gain.setValueAtTime(volume * MASTER_VOLUME, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.015);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.015);
}

async function playSuccessChime() {
    const ctx = await getAudioCtx();
    if (!ctx) return;
    [523.25, 659.25, 783.99].forEach((f, i) => {
        setTimeout(() => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = f;
            gain.gain.setValueAtTime(0.08 * MASTER_VOLUME, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        }, i * 80);
    });
}

export const Sounds = {
    async resume() {
        if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
    },
    
    // ========== ОСНОВНЫЕ ИГРОВЫЕ ЗВУКИ ==========
    
    async mine() {
        await this.resume();
        await playDigitalClick(0.18);
        await playModernTone({ frequency: 110, type: 'triangle', duration: 0.1, volume: 0.2, attack: 0.002, freqEnd: 50, filterFreq: 800 });
        await playSpaceNoise({ duration: 0.04, volume: 0.06, filterFreq: 5000, type: 'white' });
    },
    
    async combo(level = 1) {
        await this.resume();
        const pitchShift = Math.min(level * 15, 500);
        await playDigitalClick(0.15);
        await playModernTone({ frequency: 160 + pitchShift, type: 'sine', duration: 0.08, volume: 0.18, attack: 0.002, freqEnd: 100 + pitchShift });
    },
    
    async critical() {
        await this.resume();
        await playModernTone({ frequency: 50, type: 'sine', duration: 0.4, volume: 0.35, attack: 0.005, freqEnd: 20 });
        setTimeout(() => { playModernTone({ frequency: 1800, type: 'sine', duration: 0.06, volume: 0.1, attack: 0.001, freqEnd: 800 }); }, 10);
    },
    
    // ========== РЕСУРСЫ ==========
    
    async chips() {
        await this.resume();
        await playModernTone({ frequency: 1800, type: 'sine', duration: 0.05, volume: 0.1, attack: 0.002, detune: 15 });
        setTimeout(() => playModernTone({ frequency: 2600, type: 'sine', duration: 0.04, volume: 0.07 }), 30);
    },
    
    async plasma() {
        await this.resume();
        await playSpaceNoise({ duration: 0.4, volume: 0.15, filterFreq: 1500, type: 'pink' });
        await playModernTone({ frequency: 180, type: 'sawtooth', duration: 0.3, volume: 0.1, filterFreq: 500, attack: 0.08 });
    },
    
    async coalOn() {
        await this.resume();
        await playModernTone({ frequency: 110, type: 'sine', duration: 0.3, volume: 0.12 });
        await playSpaceNoise({ duration: 0.2, volume: 0.08, filterFreq: 800 });
    },
    
    async coalOff() {
        await this.resume();
        await playModernTone({ frequency: 80, type: 'sine', duration: 0.2, volume: 0.1 });
    },
    
    // ========== КРАФТ И РАЗРАБОТКА ==========
    
    async craft() {
        await this.resume();
        await playModernTone({ frequency: 1800, type: 'sine', duration: 0.05, volume: 0.1, attack: 0.002, detune: 15 });
        setTimeout(() => playModernTone({ frequency: 2600, type: 'sine', duration: 0.04, volume: 0.07 }), 30);
        await playSoftClickInternal(0.06);
    },
    
    async design() {
        await this.resume();
        await playModernTone({ frequency: 440, type: 'sine', duration: 0.3, volume: 0.08, attack: 0.05, freqEnd: 880 });
        await playSoftClickInternal(0.08);
    },
    
    // ========== УЛУЧШЕНИЯ ==========
    
    async upgrade() {
        await this.resume();
        [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => { 
            setTimeout(() => { 
                playModernTone({ frequency: f, type: 'sine', duration: 0.5, volume: 0.1, attack: 0.04 }); 
            }, i * 50); 
        });
    },
    
    async defense() {
        await this.resume();
        await playModernTone({ frequency: 220, type: 'triangle', duration: 0.4, volume: 0.12, attack: 0.05, filterFreq: 600 });
        await playSpaceNoise({ duration: 0.2, volume: 0.08, filterFreq: 800 });
    },
    
    // ========== ФЛОТ ==========
    
    async shipSend() {
        await this.resume();
        const ctx = await getAudioCtx();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.3);
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        gain.gain.setValueAtTime(0.12 * MASTER_VOLUME, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    },
    
    async shipCreate() {
        await this.resume();
        await playModernTone({ frequency: 880, type: 'sine', duration: 0.2, volume: 0.12 });
        await playSuccessChime();
    },
    
    async shipReturn() {
        await this.resume();
        await playModernTone({ frequency: 440, type: 'sine', duration: 0.3, volume: 0.1, freqEnd: 220 });
    },
    
    // ========== КЛИКИ И НАВИГАЦИЯ ==========
    
    async click() {
        await this.resume();
        await playDigitalClick(0.1);
    },
    
    async softClick() {
        await this.resume();
        await playSoftClickInternal(0.08);
    },
    
    async tabSwitch() {
        await this.resume();
        await playSoftClickInternal(0.06);
    },
    
    async panelToggle() {
        await this.resume();
        await playSoftClickInternal(0.05);
    },
    
    // ========== АТАКИ ==========
    
    async rebelAttack() {
        await this.resume();
        await playSpaceNoise({ duration: 1.2, volume: 0.25, filterFreq: 120, type: 'pink' });
        await playModernTone({ frequency: 80, type: 'sawtooth', duration: 0.8, volume: 0.15, freqEnd: 40, filterFreq: 250 });
    },
    
    async attackReflected() {
        await this.resume();
        await playModernTone({ frequency: 880, type: 'square', duration: 0.1, volume: 0.12 });
        await playModernTone({ frequency: 440, type: 'square', duration: 0.15, volume: 0.1 });
    },
    
    async warning() {
        await this.resume();
        for (let i = 0; i < 3; i++) { 
            setTimeout(() => { 
                playModernTone({ frequency: 880, type: 'triangle', duration: 0.15, volume: 0.15, filterFreq: 2000 }); 
                playSpaceNoise({ duration: 0.1, volume: 0.1, filterFreq: 1000, type: 'white' }); 
            }, i * 400); 
        }
    },
    
    // ========== ТОРГОВЛЯ ==========
    
    async trade() {
        await this.resume();
        await playModernTone({ frequency: 440, type: 'sine', duration: 0.08, volume: 0.1, attack: 0.005 });
        setTimeout(() => playModernTone({ frequency: 660, type: 'sine', duration: 0.12, volume: 0.09, attack: 0.005 }), 80);
        setTimeout(() => playModernTone({ frequency: 880, type: 'sine', duration: 0.1, volume: 0.07, attack: 0.005 }), 160);
    },
    
    // ========== ВРЕМЯ ==========
    
    async nightStart() {
        await this.resume();
        await playSpaceNoise({ duration: 2.5, volume: 0.12, filterFreq: 60 });
        await playModernTone({ frequency: 180, type: 'sine', duration: 2, volume: 0.06, attack: 1.5, freqEnd: 60 });
    },
    
    async dayStart() {
        await this.resume();
        await playModernTone({ frequency: 660, type: 'sine', duration: 0.3, volume: 0.1 });
        await playModernTone({ frequency: 880, type: 'sine', duration: 0.2, volume: 0.08 });
    },
    
    // ========== ЭВОЛЮЦИЯ И КВЕСТЫ ==========
    
    async evolution() {
        await this.resume();
        let f = 110;
        for(let i=0; i<10; i++) { 
            setTimeout(() => { 
                playModernTone({ frequency: f, type: 'sine', duration: 0.4, volume: 0.08, attack: 0.03 }); 
                f *= 1.15; 
            }, i * 60); 
        }
        await playSpaceNoise({ duration: 1.5, volume: 0.15, filterFreq: 2500 });
        setTimeout(() => playSuccessChime(), 600);
    },
    
    async questDone() {
        await this.resume();
        await playModernTone({ frequency: 1046.50, type: 'sine', duration: 0.1, volume: 0.12, attack: 0.01 });
        setTimeout(() => { playModernTone({ frequency: 1318.51, type: 'sine', duration: 0.25, volume: 0.1, attack: 0.01 }); }, 120);
        setTimeout(() => playSuccessChime(), 200);
    },
    
    // ========== АВТОКЛИКЕР ==========
    
    async autoStart() {
        await this.resume();
        await playModernTone({ frequency: 880, type: 'sine', duration: 0.15, volume: 0.12 });
        await playModernTone({ frequency: 1100, type: 'sine', duration: 0.2, volume: 0.1 });
    },
    
    async autoStop() {
        await this.resume();
        await playModernTone({ frequency: 660, type: 'sine', duration: 0.2, volume: 0.1 });
        await playModernTone({ frequency: 440, type: 'sine', duration: 0.15, volume: 0.08 });
    },
    
    // ========== ОШИБКИ ==========
    
    async error() {
        await this.resume();
        await playModernTone({ frequency: 150, type: 'square', duration: 0.06, volume: 0.12, filterFreq: 1200 });
        setTimeout(() => { playModernTone({ frequency: 100, type: 'square', duration: 0.1, volume: 0.1, filterFreq: 600 }); }, 40);
    },
    
    // ========== УПРАВЛЕНИЕ ЗВУКОМ ==========
    
    async toggleMute() {
        isAudioEnabled = !isAudioEnabled;
        if (!isAudioEnabled && audioCtx) audioCtx.suspend();
        else if (isAudioEnabled && audioCtx) { 
            await audioCtx.resume(); 
            playModernTone({ frequency: 880, type: 'sine', duration: 0.1, volume: 0.1 }); 
        }
        return isAudioEnabled;
    },
    
    isMuted() { return !isAudioEnabled; },
    
    getSoundStatus() { 
        return { enabled: isAudioEnabled, context: audioCtx?.state || 'suspended' }; 
    }
};

export default Sounds;