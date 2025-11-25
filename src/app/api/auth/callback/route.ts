// src/app/auth/callback/route.ts

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const cookieStore = cookies()
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  
  // This is the URL the user will be sent to AFTER the session is established
  // If no 'next' is provided, send them to the root page.
  const next = url.searchParams.get('next') || '/' 

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value
          },
          set(name: string, value: string, options: any) {
            cookieStore.set({ name, value, ...options })
          },
          remove(name: string, options: any) {
            cookieStore.set({ name, value: '', ...options })
          },
        },
      }
    )
    
    // Exchange the code for a session
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Redirect the user to the destination page (e.g., '/')
      return NextResponse.redirect(url.origin + next)
    }
  }

  // Return to the home page with an error or generic message
  return NextResponse.redirect(url.origin) 
}

// NOTE: Add dynamic flag for good measure, as it handles server-side cookies
export const dynamic = 'force-dynamic';