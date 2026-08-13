import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  importacion_id: z.string().uuid(),
  decisiones: z.array(z.object({
    md_id: z.string().uuid(),
    articulo_id: z.string().min(1),
  })).min(1).max(5000),
});

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request', details: parsed.error.flatten() }, { status: 400 });
  }
  
  const { importacion_id, decisiones } = parsed.data;
  
  // 1) Crear job persistente
  const { data: job, error: jobErr } = await supabase
    .from('matching_confirm_jobs')
    .insert({
      importacion_id,
      decisiones: decisiones.map(d => ({ id: d.md_id, articulo_id: d.articulo_id })),
      total: decisiones.length,
    })
    .select('id')
    .single();
    
  if (jobErr || !job) {
    return NextResponse.json({ error: 'job_create_failed', details: jobErr?.message }, { status: 500 });
  }
  
  // 2) Encolar en jobs para que lo tome el worker existente
  const { error: enqErr } = await supabase.from('jobs').insert({
    type: 'confirm_matching_batch',
    payload: { confirm_job_id: job.id },
    priority: 5,
    status: 'pending'
  });
  
  if (enqErr) {
    // best effort: dejar el job en queued; el reaper lo re-encolará
    console.warn('[confirm-batch] enqueue failed', enqErr);
  }
  
  return NextResponse.json({ job_id: job.id, status: 'queued', total: decisiones.length }, { status: 202 });
}
