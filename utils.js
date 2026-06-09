// utils.js - общие утилиты для всего проекта
// БАГ #29: единая функция escapeHtml

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

// Нормализация нейро-сознания (БАГ #20)
export function normalizeNeuroConsciousness(value) {
    if (value == null) return 0;
    // Если пришло как проценты (например 75.5 вместо 0.755)
    if (value > 1.0) value = value / 100.0;
    return Math.min(1.0, Math.max(0.0, value));
}

export default { escapeHtml, normalizeNeuroConsciousness };