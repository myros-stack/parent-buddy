// src/app/api/settings/route.ts

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/**
 * Initialize Supabase Server Client
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
 * Retrieve current settings and filter history
 */
export async function GET() {
  try {
    const supabase = await getSupabaseClient()

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

    // Fetch current settings from profiles table
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('allowed_sources, created_at')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Supabase error fetching profile:', profileError)
      return NextResponse.json(
        { error: 'Failed to load settings.' },
        { status: 500 }
      )
    }

    // Fetch filter history
    let filterHistory = []
    try {
      const { data: history, error: historyError } = await supabase
        .from('filter_history')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (!historyError) {
        filterHistory = history || []
      }
    } catch (e) {
      console.log('Filter history table not ready yet')
    }

    return NextResponse.json({
      allowedSources: profile?.allowed_sources || '',
      profileCreatedAt: profile?.created_at,
      filterHistory: filterHistory,
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
 * Save allowed sender domains and track in filter history
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

    // Update the user's current settings in profiles table
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ allowed_sources: allowedSources })
      .eq('id', user.id)

    if (updateError) {
      console.error('Supabase error saving settings:', updateError)
      return NextResponse.json(
        { error: 'Failed to save settings to database.' },
        { status: 500 }
      )
    }

    // Add to filter history
    try {
      await supabase.from('filter_history').insert({
        user_id: user.id,
        filters: allowedSources,
        action: 'update',
        created_at: new Date().toISOString(),
      })
    } catch (e) {
      console.log('Could not add to filter history (table may not exist yet)')
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

/**
 * DELETE /api/settings
 * Delete a filter from history
 */
export async function DELETE(request: Request) {
  try {
    const { filterId } = await request.json()

    if (!filterId) {
      return NextResponse.json(
        { error: 'Filter ID required.' },
        { status: 400 }
      )
    }

    const supabase = await getSupabaseClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Auth error in DELETE /api/settings:', authError)
      return NextResponse.json(
        { error: 'User not authenticated.' },
        { status: 401 }
      )
    }

    // Delete filter from history table
    const { error } = await supabase
      .from('filter_history')
      .delete()
      .eq('id', filterId)
      .eq('user_id', user.id)

    if (error) {
      console.error('Supabase error deleting filter:', error)
      return NextResponse.json(
        { error: 'Failed to delete filter.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Filter deleted successfully.',
    })
  } catch (error) {
    console.error('General error in DELETE /api/settings:', error)
    return NextResponse.json(
      { error: 'Server error deleting filter.' },
      { status: 500 }
    )
  }
}