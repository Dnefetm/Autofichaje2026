import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase-server';
import { cookies } from 'next/headers';

export async function GET(_req: Request, { params }: { params: Promise<{ job_id: string }> }) {
  const supabase = await createRouteHandlerClient();
  const { data, error } = await supabase
    .from('matching_confirm_jobs')
    .select('id,status,processed,total,alias_aprendidos,error,started_at,finished_at')
    .eq('id', (await params).job_id)
    .single();
    
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}
