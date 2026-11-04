import { createClient } from '@supabase/supabase-js';

const env: any = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' && process.env ? process.env : {});
const supabaseUrl = env.VITE_SUPABASE_URL || 'https://lorxcxmwmxsesuqyzxih.supabase.co';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_B8wY6lZZuP6HKaSMg35WkQ_f-NvHtsb';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
