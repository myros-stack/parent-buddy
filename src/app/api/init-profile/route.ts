// src/app/api/init-profile/route.ts

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/**
 * Initialize Supabase Server Client with proper async cookie handling
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
 * POST /api/init-profile
 * Create a user profile if it doesn't exist (called on first login)
 */
export async function POST() {
  try {
    const supabase = await getSupabaseClient()

    // Get the authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'User not authenticated.' },
        { status: 401 }
      )
    }

    // Check if profile already exists
    const { data: existingProfile, error: selectError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single()

    if (selectError && selectError.code !== 'PGRST116') {
      // PGRST116 means "0 rows" which is expected for new users
      console.error('Error checking profile:', selectError)
      return NextResponse.json(
        { error: 'Failed to check profile.' },
        { status: 500 }
      )
    }

    // If profile exists, return success
    if (existingProfile) {
      return NextResponse.json({
        message: 'Profile already exists.',
        profileId: existingProfile.id,
      })
    }

    // Create new profile for this user
    // NOTE: Only insert id and allowed_sources - don't include email or created_at
    const { data: newProfile, error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        allowed_sources: '',
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error creating profile:', insertError)
      return NextResponse.json(
        { error: 'Failed to create profile.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Profile created successfully.',
      profileId: newProfile.id,
    })
  } catch (error) {
    console.error('General error in POST /api/init-profile:', error)
    return NextResponse.json(
      { error: 'Server error initializing profile.' },
      { status: 500 }
    )
  }
}