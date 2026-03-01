import { createClient } from '@supabase/supabase-js';

// Usar valores por defecto para evitar que la app crashee si no hay .env (Mock Mode)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

// Cliente para el cliente (Browser)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cliente de servidor (para API routes)
export const supabaseAdmin = createClient(
    process.env.SUPABASE_URL || supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey
);
