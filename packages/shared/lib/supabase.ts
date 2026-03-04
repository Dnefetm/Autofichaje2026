import { createClient } from '@supabase/supabase-js';

// Cargar variables de entorno solo en Node local, Vercel ya las tiene
if (process.env.NODE_ENV !== 'production' && typeof window === 'undefined') {
    try {
        const dotenv = require('dotenv');
        const path = require('path');
        dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
    } catch (e) {
        // Ignorar en entorno de Vercel
    }
}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
