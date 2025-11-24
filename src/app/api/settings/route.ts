// src/app/api/settings/route.ts

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

/**
 * Initialize Supabase Server Client with proper cookie handling
 */
async function getSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
      },
    }
  )
}

/**
 * GET /api/settings
 * Retrieve allowed sender domains for the authenticated user
 */
export async function GET() {
  try {
    const supabase = await getSupabaseClient()

    // Get the authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Auth error in GET /api/settings:', authError)
      return NextResponse.json(
        { error: 'User not authenticated.' },
        { status: 401 }
      )
    }

    // Fetch the user's settings from the profiles table
    const { data, error } = await supabase
      .from('profiles')
      .select('allowed_sources')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('Supabase error fetching settings:', error)
      return NextResponse.json(
        { error: 'Failed to load settings.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      allowedSources: data?.allowed_sources || '',
    })
  } catch (error) {
    console.error('General error in GET /api/settings:', error)
    return NextResponse.json(
      { error: 'Server error loading settings.' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/settings
 * Save allowed sender domains for the authenticated user
 */
export async function POST(request: Request) {
  try {
    const { allowedSources } = await request.json()

    if (!allowedSources || typeof allowedSources !== 'string') {
      return NextResponse.json(
        { error: 'Invalid allowedSources format.' },
        { status: 400 }
      )
    }

    const supabase = await getSupabaseClient()

    // Get the authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Auth error in POST /api/settings:', authError)
      return NextResponse.json(
        { error: 'User not authenticated.' },
        { status: 401 }
      )
    }

    // Update the user's settings in the profiles table
    const { error } = await supabase
      .from('profiles')
      .update({ allowed_sources: allowedSources })
      .eq('id', user.id)

    if (error) {
      console.error('Supabase error saving settings:', error)
      return NextResponse.json(
        { error: 'Failed to save settings to database.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Settings saved successfully.',
      allowedSources: allowedSources,
    })
  } catch (error) {
    console.error('General error in POST /api/settings:', error)
    return NextResponse.json(
      { error: 'Server error saving settings.' },
      { status: 500 }
    )
  }
}