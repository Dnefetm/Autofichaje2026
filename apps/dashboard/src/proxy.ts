import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Middleware de sesión Supabase: refresca la cookie y protege rutas de admin.
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // APIs de administración: requieren sesión válida y rol 'admin' (siempre JSON, nunca redirect).
  if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) {
    if (request.method === 'OPTIONS') {
      return supabaseResponse
    }
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    const { data: rol, error: rolError } = await supabase.rpc('current_rol')
    if (rolError) {
      return NextResponse.json({ error: 'No se pudo verificar el rol' }, { status: 503 })
    }
    if (rol !== 'admin') {
      return NextResponse.json({ error: 'Prohibido: se requiere rol admin' }, { status: 403 })
    }
    return supabaseResponse
  }

  // Rutas de administración: solo rol 'admin'.
  if (pathname.startsWith('/admin')) {
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
    const { data: rol } = await supabase.rpc('current_rol')
    if (rol !== 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks/.*|api/worker/.*|api/cron/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
