require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function pump() {
  console.log("Iniciando bomba de matching...");
  let empty = false;
  let loops = 0;
  while (!empty && loops < 50) {
    loops++;
    const { data: { session } } = await sb.auth.getSession();
    console.log(`Llamando Edge Function... (Intento ${loops})`);
    
    // Invocamos la edge function, que procesa 1 chunk
    const res = await sb.functions.invoke('procesar-matching', { body: {} });
    
    if (res.error) {
      console.error("Error en invocación:", res.error);
      empty = true;
    } else {
      console.log("Respuesta:", res.data);
      // Si la respuesta es OK y el progreso avanza, seguimos
      // Esperamos un segundo para no bombardear
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // Checamos si quedan pendientes
    const { data: p } = await sb.from('matching_jobs').select('id').eq('estado', 'pendiente');
    if (!p || p.length === 0) {
      console.log("Cola vacía! Job terminado.");
      empty = true;
    }
  }
}

pump();
