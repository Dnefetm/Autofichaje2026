import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { importacion_id, aprobado } = await req.json();

    if (!importacion_id) {
      return new Response(JSON.stringify({ error: 'Falta importacion_id' }), { 
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Business Gating: Exigir aprobación explícita
    if (aprobado !== true) {
       return new Response(JSON.stringify({ error: 'Falta validación humana. La variable aprobado debe ser true.' }), { 
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Obtener proveedor de la importación
    const { data: imp, error: fetchErr } = await sb
      .from('importaciones_excel')
      .select('proveedor, estado')
      .eq('id', importacion_id)
      .single();

    if (fetchErr || !imp) {
      return new Response(JSON.stringify({ error: 'Importación no encontrada' }), { 
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (imp.estado !== 'en_revision') {
      return new Response(JSON.stringify({ error: `La importación está en estado ${imp.estado} y no en_revision` }), { 
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Llamar a la consolidación usando el Service Role
    const { error: rpcErr } = await sb.rpc('fn_consolidar_revision_importacion', {
      p_importacion_id: importacion_id,
      p_proveedor: imp.proveedor
    });

    if (rpcErr) {
      throw new Error(rpcErr.message);
    }

    return new Response(JSON.stringify({ ok: true, message: 'Consolidación completada exitosamente.' }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error: any) {
    console.error("UNCAUGHT ERROR:", error?.message, error?.stack, error);
    return new Response(JSON.stringify({ error: error.message || 'Error interno del servidor', stack: error?.stack }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
