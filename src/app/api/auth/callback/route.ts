// src/app/auth/callback/route.ts

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

// The Supabase Auth flow uses a GET request to return the code.
export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  
  // This is the default page to redirect to after successful login
  const next = requestUrl.searchParams.get('next') || '/'

  if (code) {
    const cookieStore = cookies()

    // 1. Create the server-side Supabase client using environment variables
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
    
    // 2. Exchange the code for a session
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // 3. Successful login: redirect the user to the destination
      return NextResponse.redirect(requestUrl.origin + next)
    }
    
    // Optional: Log the error if the exchange failed
    if (error) {
        console.error('Supabase exchangeCodeForSession failed:', error);
    }
  }

  // 4. Failed login or missing code: redirect to the homepage
  // The user will see the login button again.
  return NextResponse.redirect(requestUrl.origin) 
}

// Important: Explicitly tell Next.js this is a dynamic route 
// because it interacts with cookies and server state.
export const dynamic = 'force-dynamic';