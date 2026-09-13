import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const requestedNext = searchParams.get('next') ?? '/'
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/'
  const destination = `${origin}${next}`

  if (code) {
    let response = NextResponse.redirect(destination)
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            )
            response = NextResponse.redirect(destination)
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            )
          },
        },
      },
    )
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      console.info('[auth/callback] session established', {
        destination: next,
        cookieCount: response.cookies.getAll().length,
      })
      return response
    }
    console.error('[auth/callback] code exchange failed', {
      error: error.message,
    })
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback`)
}
