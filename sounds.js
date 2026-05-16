// ======== sounds.js — КИБЕРПАНК / КОСМОС / ИИ ========
// БАГ №9 ИСПРАВЛЕН: getAudioCtx теперь асинхронный

const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let isAudioEnabled = true;

// Глобальный множитель громкости (0.6 = 60%, чтобы не "било" по ушам)
const MASTER_VOLUME = 0.6;

async function getAudioCtx() {
    if (!isAudioEnabled) return null;
    if (!audioCtx) {
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
    return audioCtx;
}

// ========== ВСПОМОГАТЕЛЬНЫЕ МОДУЛИ СИНТЕЗА ==========

async function playModernTone({ 
    frequency = 440, 
    type = 'sine', 
    duration = 0.15, 
    volume = 0.3, 
    attack = 0.02, 
    decay = 0.1,
    sustain = 0.3,
    freqEnd = null,
    filterFreq = 2000,
    filterQ = 1,
    detune = 0
} = {}) {
    try {
        const ctx = await getAudioCtx();
        if (!ctx) return;
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        osc.detune.setValueAtTime(detune, ctx.currentTime);
        
        if (freqEnd) {
            osc.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + duration);
        }
        
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
            } else {
                data[i] = white;
            }
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

// ========== ГЛАВНЫЙ ОБЪЕКТ ЗВУКОВ ==========

export const Sounds = {
    // 1. УЛЬТРА-ТАП (Добыча) — многослойный и сочный
    async mine() {
        await playDigitalClick(0.18);
        await playModernTone({ 
            frequency: 110, 
            type: 'triangle', 
            duration: 0.1, 
            volume: 0.2, 
            attack: 0.002, 
            freqEnd: 50,
            filterFreq: 800 
        });
        await playSpaceNoise({ 
            duration: 0.04, 
            volume: 0.06, 
            filterFreq: 5000, 
            type: 'white' 
        });
    },

    // 2. КОМБО (динамический звук)
    async combo(level = 1) {
        const pitchShift = Math.min(level * 15, 500);
        await playDigitalClick(0.15);
        await playModernTone({ 
            frequency: 160 + pitchShift, 
            type: 'sine', 
            duration: 0.08, 
            volume: 0.18, 
            attack: 0.002,
            freqEnd: 100 + pitchShift
        });
    },

    // 3. КРИТИЧЕСКИЙ УДАР
    async critical() {
        await playModernTone({ frequency: 50, type: 'sine', duration: 0.4, volume: 0.35, attack: 0.005, freqEnd: 20 });
        setTimeout(() => {
            playModernTone({ frequency: 1800, type: 'sine', duration: 0.06, volume: 0.1, attack: 0.001, freqEnd: 800 });
        }, 10);
    },

    // 4. ДОБЫЧА ЧИПОВ
    async chips() {
        await playModernTone({ frequency: 1800, type: 'sine', duration: 0.05, volume: 0.1, attack: 0.002, detune: 15 });
        setTimeout(() => playModernTone({ frequency: 2600, type: 'sine', duration: 0.04, volume: 0.07 }), 30);
    },

    // 5. ДОБЫЧА ПЛАЗМЫ
    async plasma() {
        await playSpaceNoise({ duration: 0.4, volume: 0.15, filterFreq: 1500, type: 'pink' });
        await playModernTone({ frequency: 180, type: 'sawtooth', duration: 0.3, volume: 0.1, filterFreq: 500, attack: 0.08 });
    },

    // 6. АПГРЕЙД
    async upgrade() {
        [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
            setTimeout(() => {
                playModernTone({ frequency: f, type: 'sine', duration: 0.5, volume: 0.1, attack: 0.04 });
            }, i * 50);
        });
    },

    // 7. ОШИБКА
    async error() {
        await playModernTone({ frequency: 150, type: 'square', duration: 0.06, volume: 0.12, filterFreq: 1200 });
        setTimeout(() => {
            playModernTone({ frequency: 100, type: 'square', duration: 0.1, volume: 0.1, filterFreq: 600 });
        }, 40);
    },

    // 8. АТАКА / РИСК
    async rebelAttack() {
        await playSpaceNoise({ duration: 1.2, volume: 0.25, filterFreq: 120, type: 'pink' });
        await playModernTone({ frequency: 80, type: 'sawtooth', duration: 0.8, volume: 0.15, freqEnd: 40, filterFreq: 250 });
    },

    // 9. ЭВОЛЮЦИЯ ИИ
    async evolution() {
        let f = 110;
        for(let i=0; i<10; i++) {
            setTimeout(() => {
                playModernTone({ frequency: f, type: 'sine', duration: 0.4, volume: 0.08, attack: 0.03 });
                f *= 1.15;
            }, i * 60);
        }
        await playSpaceNoise({ duration: 1.5, volume: 0.15, filterFreq: 2500 });
    },

    // 10. КВЕСТ ВЫПОЛНЕН
    async questDone() {
        await playModernTone({ frequency: 1046.50, type: 'sine', duration: 0.1, volume: 0.12, attack: 0.01 });
        setTimeout(() => {
            playModernTone({ frequency: 1318.51, type: 'sine', duration: 0.25, volume: 0.1, attack: 0.01 });
        }, 120);
    },

    // 11. НАСТУПЛЕНИЕ НОЧИ
    async nightStart() {
        await playSpaceNoise({ duration: 2.5, volume: 0.12, filterFreq: 60 });
        await playModernTone({ frequency: 180, type: 'sine', duration: 2, volume: 0.06, attack: 1.5, freqEnd: 60 });
    },

    // 12. ПРЕДУПРЕЖДЕНИЕ
    async warning() {
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                playModernTone({ frequency: 880, type: 'triangle', duration: 0.15, volume: 0.15, filterFreq: 2000 });
                playSpaceNoise({ duration: 0.1, volume: 0.1, filterFreq: 1000, type: 'white' });
            }, i * 400);
        }
    },

    // УПРАВЛЕНИЕ ЗВУКОМ
    async toggleMute() {
        isAudioEnabled = !isAudioEnabled;
        if (!isAudioEnabled && audioCtx) {
            audioCtx.suspend();
        } else if (isAudioEnabled && audioCtx) {
            await audioCtx.resume();
            await playModernTone({ frequency: 880, type: 'sine', duration: 0.1, volume: 0.1 });
        }
        return isAudioEnabled;
    },

    isMuted() {
        return !isAudioEnabled;
    }
};

export default Sounds;