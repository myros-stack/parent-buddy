// src/app/api/calendar/route.ts

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { google } from 'googleapis'

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

export async function POST(request: Request) {
  try {
    const { events } = await request.json()

    if (!events || events.length === 0) {
      return NextResponse.json({
        scheduledCount: 0,
        message: 'No events provided',
      })
    }

    const supabase = await getSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.provider_token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: session.provider_token })
    const calendar = google.calendar({ version: 'v3', auth })

    let scheduled = 0

    for (const event of events) {
      try {
        const calendarEvent: any = {
          summary: event.title || 'Event',
          description: event.description || '',
          start: { date: event.date },
          end: { date: event.date },
        }

        console.log(`Scheduling: ${event.title} on ${event.date}`)

        await calendar.events.insert({
          calendarId: 'primary',
          requestBody: calendarEvent,
        })

        scheduled++
        console.log(`✓ Scheduled`)
      } catch (e) {
        console.log(`✗ Failed: ${e}`)
      }
    }

    return NextResponse.json({
      scheduledCount: scheduled,
      message: `Scheduled ${scheduled} events`,
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}