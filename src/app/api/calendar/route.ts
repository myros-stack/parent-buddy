// src/app/api/calendar/route.ts

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'

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

function parseTimeString(timeStr: string): { hours: number; minutes: number } | null {
  if (!timeStr || timeStr.toLowerCase().includes('no time')) return null

  const time = timeStr.trim().toLowerCase()

  // HH:MM:SS format
  const fullMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (fullMatch) {
    let hours = parseInt(fullMatch[1], 10)
    const minutes = parseInt(fullMatch[2], 10)
    
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes }
    }
  }

  // Ham/pm or H:MMam/pm format
  const ampmMatch = time.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10)
    const minutes = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0
    const isPm = ampmMatch[3] === 'pm'
    
    if (isPm && hours !== 12) hours += 12
    else if (!isPm && hours === 12) hours = 0

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes }
    }
  }

  return null
}

export async function POST(request: Request) {
  try {
    const { events, userTimeZone } = await request.json()

    if (!events || events.length === 0) {
      return NextResponse.json({
        scheduledCount: 0,
        message: 'No events to schedule.',
      })
    }

    const supabase = await getSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.provider_token) {
      return NextResponse.json({ error: 'Not authenticated with Google' }, { status: 401 })
    }

    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: session.provider_token })
    const calendar = google.calendar({ version: 'v3', auth })

    // Get today's date in user's timezone
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    let scheduledCount = 0
    let skippedCount = 0

    for (const event of events) {
      try {
        if (!event.date || !event.title) {
          skippedCount++
          continue
        }

        // Parse date (YYYY-MM-DD format)
        const [year, month, day] = event.date.split('-').map(Number)
        const eventDate = new Date(year, month - 1, day)

        // Skip past events
        if (eventDate < today) {
          skippedCount++
          continue
        }

        const calendarEvent: any = {
          summary: event.title,
          description: event.description || '',
          colorId: '4', // Teal color
        }

        if (event.location) {
          calendarEvent.location = event.location
        }

        const parsedTime = parseTimeString(event.time)

        if (parsedTime) {
          // Timed event
          const startDateTime = new Date(year, month - 1, day, parsedTime.hours, parsedTime.minutes)
          const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000) // 1 hour duration

          calendarEvent.start = {
            dateTime: startDateTime.toISOString(),
            timeZone: userTimeZone || 'UTC',
          }
          calendarEvent.end = {
            dateTime: endDateTime.toISOString(),
            timeZone: userTimeZone || 'UTC',
          }
        } else {
          // All-day event
          const endDate = new Date(year, month - 1, day + 1)
          
          calendarEvent.start = {
            date: event.date,
          }
          calendarEvent.end = {
            date: `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`,
          }
        }

        await calendar.events.insert({
          calendarId: 'primary',
          requestBody: calendarEvent,
        })

        scheduledCount++
      } catch (error) {
        console.error(`Error scheduling event "${event.title}":`, error)
        skippedCount++
      }
    }

    return NextResponse.json({
      scheduledCount,
      skippedCount,
      message:
        scheduledCount > 0
          ? `Successfully scheduled ${scheduledCount} event(s)`
          : 'No valid events to schedule.',
    })
  } catch (error) {
    console.error('Calendar route error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to schedule events' },
      { status: 500 }
    )
  }
}