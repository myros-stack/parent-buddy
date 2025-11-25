// src/app/api/calendar/route.ts - FIXED

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

/**
 * Parse time strings in multiple formats
 * Supports: 3pm, 15:00, 3:00:00, 15, 3:00pm, etc.
 */
function parseTimeString(timeStr: string): { hours: number; minutes: number; seconds: number } | null {
  if (!timeStr || timeStr === 'No time' || timeStr === 'No time provided') {
    return null
  }

  const time = timeStr.trim().toLowerCase()

  // Format: HH:MM:SS (24-hour)
  const hhmmssMatch = time.match(/^(\d{1,2}):(\d{2}):(\d{2})$/)
  if (hhmmssMatch) {
    const hours = parseInt(hhmmssMatch[1], 10)
    const minutes = parseInt(hhmmssMatch[2], 10)
    const seconds = parseInt(hhmmssMatch[3], 10)
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59) {
      return { hours, minutes, seconds }
    }
  }

  // Format: HH:MM (24-hour)
  const hhmmMatch = time.match(/^(\d{1,2}):(\d{2})$/)
  if (hhmmMatch) {
    const hours = parseInt(hhmmMatch[1], 10)
    const minutes = parseInt(hhmmMatch[2], 10)
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes, seconds: 0 }
    }
  }

  // Format: HH (24-hour, just hour)
  const hhMatch = time.match(/^(\d{1,2})$/)
  if (hhMatch) {
    const hours = parseInt(hhMatch[1], 10)
    if (hours >= 0 && hours <= 23) {
      return { hours, minutes: 0, seconds: 0 }
    }
  }

  // Format: H:MMam/pm or HH:MMam/pm
  const ampmMatch = time.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/)
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10)
    const minutes = parseInt(ampmMatch[2], 10)
    const isPm = ampmMatch[3] === 'pm'

    if (isPm && hours !== 12) hours += 12
    else if (!isPm && hours === 12) hours = 0

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes, seconds: 0 }
    }
  }

  // Format: Ham/pm or HPMam/pm (just hour with am/pm)
  const hampmMatch = time.match(/^(\d{1,2})\s*(am|pm)$/)
  if (hampmMatch) {
    let hours = parseInt(hampmMatch[1], 10)
    const isPm = hampmMatch[2] === 'pm'

    if (isPm && hours !== 12) hours += 12
    else if (!isPm && hours === 12) hours = 0

    if (hours >= 0 && hours <= 23) {
      return { hours, minutes: 0, seconds: 0 }
    }
  }

  return null
}

/**
 * Get user's local timezone
 */
function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * Map event category to Google Calendar colorId
 */
function getCategoryColorId(category: string): string {
  const categoryToColorId: { [key: string]: string } = {
    'Events': '1',              // Red
    'Deadlines': '3',           // Orange
    'Schedule changes': '7',    // Blue
    'Student updates': '5',     // Green
    'General info': '11',       // Gray
  }

  return categoryToColorId[category] || '11'
}

export async function POST(request: Request) {
  try {
    const { events } = await request.json()

    if (!events || events.length === 0) {
      return NextResponse.json({
        scheduledCount: 0,
        message: 'No events to schedule.',
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

    // Get local timezone
    const localTimezone = getLocalTimezone()
    console.log(`\n📅 Using timezone: ${localTimezone}`)

    // Get today's date at start of day
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    console.log(`📋 Today: ${today.toISOString().split('T')[0]}`)
    console.log(`Processing ${events.length} event(s)...`)

    let scheduledCount = 0
    let skippedCount = 0

    for (const event of events) {
      try {
        // Validate event has required fields
        if (!event.date || !event.title) {
          console.log(`⏭️ Skipping: missing date or title`)
          skippedCount++
          continue
        }

        // Parse date string (format: YYYY-MM-DD)
        const dateParts = event.date.split('-')
        if (dateParts.length !== 3) {
          console.log(`⏭️ Skipping "${event.title}": invalid date format`)
          skippedCount++
          continue
        }

        const year = parseInt(dateParts[0], 10)
        const month = parseInt(dateParts[1], 10)
        const day = parseInt(dateParts[2], 10)

        // Create date object
        const eventDate = new Date(year, month - 1, day)
        eventDate.setHours(0, 0, 0, 0)

        console.log(`\n📌 Event: "${event.title}" on ${event.date}`)

        // Skip past events
        if (eventDate.getTime() < today.getTime()) {
          console.log(`   ⏭️ Skipping: past event`)
          skippedCount++
          continue
        }

        const calendarEvent: any = {
          summary: event.title,
          description: event.description || '',
        }

        if (event.location) {
          calendarEvent.location = event.location
        }

        // Handle time
        let hasValidTime = false
        if (event.time && event.time !== 'No time' && event.time !== 'No time provided') {
          const parsedTime = parseTimeString(event.time)
          if (parsedTime) {
            hasValidTime = true
            // Create timed event
            const startDateTime = new Date(year, month - 1, day, parsedTime.hours, parsedTime.minutes, parsedTime.seconds)
            const endDateTime = new Date(year, month - 1, day, parsedTime.hours + 1, parsedTime.minutes, parsedTime.seconds)

            calendarEvent.start = {
              dateTime: startDateTime.toISOString(),
              timeZone: localTimezone,
            }
            calendarEvent.end = {
              dateTime: endDateTime.toISOString(),
              timeZone: localTimezone,
            }
            console.log(`   ⏰ Timed: ${parsedTime.hours}:${String(parsedTime.minutes).padStart(2, '0')}`)
          }
        }

        // If no valid time, make it all-day
        if (!hasValidTime) {
          const endDate = new Date(year, month - 1, day + 1)
          calendarEvent.start = {
            date: event.date,
          }
          calendarEvent.end = {
            date: endDate.toISOString().split('T')[0],
          }
          console.log(`   📅 All-day`)
        }

        // Add color
        const colorId = getCategoryColorId(event.category)
        calendarEvent.colorId = colorId
        console.log(`   🎨 Color ID: ${colorId}`)

        calendarEvent.reminders = {
          useDefault: false,
          overrides: [
            { method: 'notification', minutes: 24 * 60 },
            { method: 'notification', minutes: 60 },
          ],
        }

        // Insert event
        await calendar.events.insert({
          calendarId: 'primary',
          requestBody: calendarEvent,
        })

        console.log(`   ✓ Scheduled`)
        scheduledCount++
      } catch (error) {
        console.error(`   ✗ Error:`, error)
        skippedCount++
      }
    }

    console.log(`\n✅ Complete: ${scheduledCount} scheduled, ${skippedCount} skipped\n`)

    return NextResponse.json({
      scheduledCount,
      skippedCount,
      message:
        scheduledCount > 0
          ? `Successfully scheduled ${scheduledCount} event(s)`
          : 'No valid events to schedule.',
    })
  } catch (error) {
    console.error('Error in POST /api/calendar:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to schedule events' },
      { status: 500 }
    )
  }
}