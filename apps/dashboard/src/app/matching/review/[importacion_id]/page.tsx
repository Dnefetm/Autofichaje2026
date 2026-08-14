import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { ReviewClient } from './review-client';

export default async function Page({ params }: { params: { importacion_id: string } }) {
  const supabase = createServerComponentClient({ cookies });

  const { data: rows } = await supabase
    .from('v_matching_review')
    .select('*')
    .eq('importacion_id', params.importacion_id)
    .order('nivel', { ascending: true });

  return <ReviewClient importacionId={params.importacion_id} rows={rows ?? []} />;
}
