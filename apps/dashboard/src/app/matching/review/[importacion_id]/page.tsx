import { createServerComponentClient } from '@/lib/supabase-server';
import { cookies } from 'next/headers';
import { ReviewClient } from './review-client';

export default async function Page({ params }: { params: Promise<{ importacion_id: string }> }) {
  const supabase = await createServerComponentClient();

  const { data: rows } = await supabase
    .from('v_matching_review')
    .select('*')
    .eq('importacion_id', (await params).importacion_id)
    .order('nivel', { ascending: true });

  return <ReviewClient importacionId={(await params).importacion_id} rows={rows ?? []} />;
}
