// supabase.js
// Инициализация подключения к Supabase

// ВАШИ КЛЮЧИ из Project Settings → API
const SUPABASE_URL = "https://xnbtizdqhpyvafftnlcb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuYnRpemRxaHB5dmFmZnRubGNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODM3NTUsImV4cCI6MjA5MTY1OTc1NX0.9qrJJctl5o6q_stFSqMmtLbKyZzR8rrpiQppaG1f72o";

// ПРАВИЛЬНО для CDN-версии (подключается через глобальный window.supabase)
const { createClient } = window.supabase;

// Создаем клиент Supabase
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log("🔌 Supabase клиент инициализирован");