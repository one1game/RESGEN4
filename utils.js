export function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        return '&#39;';
    });
}

export function normalizeNeuroConsciousness(value) {
    if (typeof value !== 'number' || isNaN(value)) return 0;

    if (value > 1.05) return Math.max(0, Math.min(1, value / 100));
    return Math.max(0, Math.min(1, value));
}

export function normalizeTimestamp(value) {
    if (value == null) return 0;
    if (typeof value === 'number') {

        return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
}

export function debounce(fn, delay = 300) {
    let timeout = null;
    return function(...args) {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            fn.apply(this, args);
            timeout = null;
        }, delay);
    };
}

export function memoize(fn, maxAge = 5000) {
    const cache = new Map();
    return function(...args) {
        const key = JSON.stringify(args);
        const now = Date.now();
        const cached = cache.get(key);
        if (cached && (now - cached.timestamp) < maxAge) {
            return cached.value;
        }
        const result = fn.apply(this, args);
        cache.set(key, { value: result, timestamp: now });
        return result;
    };
}

export default {
    escapeHtml,
    normalizeNeuroConsciousness,
    normalizeTimestamp,
    debounce,
    memoize
};