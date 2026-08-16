import os
import re

SERVER_CLIENT_CODE = """import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createRouteHandlerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch (error) {}
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options })
          } catch (error) {}
        },
      },
    }
  )
}
export const createServerComponentClient = createRouteHandlerClient;
"""

def fix_dashboard():
    lib_path = 'apps/dashboard/src/lib/supabase-server.ts'
    with open(lib_path, 'w', encoding='utf-8') as f:
        f.write(SERVER_CLIENT_CODE)

    # Rutas a arreglar
    routes = [
        'apps/dashboard/src/app/api/matching/confirm-batch/route.ts',
        'apps/dashboard/src/app/api/alias/[alias_id]/route.ts',
        'apps/dashboard/src/app/api/alias/route.ts',
        'apps/dashboard/src/app/api/matching/jobs/[job_id]/route.ts',
        'apps/dashboard/src/app/matching/review/[importacion_id]/page.tsx'
    ]

    for route in routes:
        if not os.path.exists(route):
            continue
        with open(route, 'r', encoding='utf-8') as f:
            content = f.read()

        # Fix import
        content = content.replace("from '@supabase/auth-helpers-nextjs'", "from '@/lib/supabase-server'")
        
        # Fix param signature (Next 15)
        content = re.sub(r'({ params }: { params: { ([^}]+) } })', r'{ params }: { params: Promise<{ \2 }> }', content)
        
        # Add await to cookies() if it exists
        content = content.replace("createRouteHandlerClient({ cookies })", "await createRouteHandlerClient()")
        content = content.replace("createServerComponentClient({ cookies })", "await createServerComponentClient()")
        
        # In route handlers, we must await params!
        if 'params' in content and 'Promise' in content:
            # We need to extract the params.
            # E.g. params.alias_id -> we must await params first.
            # A simple regex to find `params.XXX` and prepend `const { XXX } = await params;` is risky.
            # Instead, just replace `params.something` with `(await params).something`
            content = re.sub(r'params\.([a-zA-Z0-9_]+)', r'(await params).\1', content)

        with open(route, 'w', encoding='utf-8') as f:
            f.write(content)

def fix_worker():
    path = 'apps/worker/src/processor.ts'
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # 'pub' is possibly 'null'
    for i, line in enumerate(lines):
        if 'pub.' in line and 'pub is possibly null' not in line:
            lines[i] = line.replace('pub.', 'pub?.')
        if 'pub = ' in line:
            pass
            
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines)

if __name__ == '__main__':
    fix_dashboard()
    fix_worker()
    print("Fixes applied.")
