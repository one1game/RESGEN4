// supabase.js - ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ
// Прямой импорт ES модуля, без зависимости от window.supabase

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = "https://xnbtizdqhpyvafftnlcb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuYnRpemRxaHB5dmFmZnRubGNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODM3NTUsImV4cCI6MjA5MTY1OTc1NX0.9qrJJctl5o6q_stFSqMmtLbKyZzR8rrpiQppaG1f72o";

// Создаём клиент сразу при импорте
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log("🔌 Supabase клиент инициализирован (прямой импорт)");