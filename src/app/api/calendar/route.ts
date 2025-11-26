// src/app/api/calendar/route.ts

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { google } from 'googleapis'
import { parseISO, format, startOfDay } from 'date-fns'
import { utcToZonedTime, format as formatToTimeZone } from 'date-fns-tz'

// --- Configuration Constants ---
// Google Calendar Color ID for Teal (Sage)
const TEAL_COLOR_ID = '4' 

// --- Supabase Helper ---
async function getSupabaseClient() {
  const cookieStore = cookies()

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
 * Parses time strings in multiple formats (e.g., 3pm, 15:00, 3:00:00pm)
 * Returns {hours, minutes, seconds} or null if invalid.
 */
function parseTimeString(timeStr: string): { hours: number; minutes: number; seconds: number } | null {
  if (!timeStr || timeStr.toLowerCase().includes('no time')) return null

  const time = timeStr.trim().toLowerCase()

  // Match formats: HH:MM:SS, HH:MM, or HH
  const fullMatch = time.match(/^(\d{1,2}):?(\d{2})?:?(\d{2})?$/)
  if (fullMatch) {
    let hours = parseInt(fullMatch[1], 10)
    const minutes = fullMatch[2] ? parseInt(fullMatch[2], 10) : 0
    const seconds = fullMatch[3] ? parseInt(fullMatch[3], 10) : 0
    
    // Check for am/pm suffix to adjust 12-hour clock formats
    const isPm = time.includes('pm')
    if (isPm && hours !== 12) hours += 12
    else if (!isPm && hours === 12) hours = 0 // Midnight case (12am -> 0)

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59) {
      return { hours, minutes, seconds }
    }
  }

  // Final check for 12-hour formats like "3pm"
  const ampmMatch = time.match(/^(\d{1,2})(am|pm)$/)
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10)
    const isPm = ampmMatch[2] === 'pm'
    
    if (isPm && hours !== 12) hours += 12
    else if (!isPm && hours === 12) hours = 0

    if (hours >= 0 && hours <= 23) {
      return { hours, minutes: 0, seconds: 0 }
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
    
    // --- 1. Authentication Check ---
    const supabase = await getSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.provider_token) {
      return NextResponse.json({ error: 'Not authenticated with Google' }, { status: 401 })
    }

    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: session.provider_token })
    const calendar = google.calendar({ version: 'v3', auth })

    // --- 2. Processing Logic ---
    // CRITICAL FIX: Define the comparison boundary accurately in the user's timezone.
    const nowInUserTZ = utcToZonedTime(new Date(), userTimeZone || 'UTC')
    const todayInUserTZStart = startOfDay(nowInUserTZ)
    
    let scheduledCount = 0
    let skippedCount = 0

    for (const event of events) {
      try {
        if (!event.date || !event.title) {
          skippedCount++
          continue
        }

        // Parse date (e.g., '2025-11-26')
        const parsedEventDate = parseISO(event.date)
        const eventStartDay = startOfDay(parsedEventDate) 
        
        // --- Schedule Future Events (Including Today) ---
        // FIX IMPLEMENTED HERE: Compare the event's start-of-day against the user's start-of-day.
        if (eventStartDay.getTime() < todayInUserTZStart.getTime()) {
            // console.log(`   ⏭️ Skipping: Past event. Event day: ${format(eventStartDay, 'yyyy-MM-dd')}, Today's start: ${format(todayInUserTZStart, 'yyyy-MM-dd')}`);
            skippedCount++;
            continue;
        }

        const calendarEvent: any = {
          summary: event.title,
          description: event.description || '',
          colorId: TEAL_COLOR_ID, // Force Teal color
        }

        if (event.location) {
          calendarEvent.location = event.location
        }
        
        const parsedTime = parseTimeString(event.time)
        const hasValidTime = !!parsedTime
        
        // --- Time-Aware Scheduling ---
        if (hasValidTime) {
          // Combine date (YYYY-MM-DD) and time (HH:MM:SS) into a single date object
          const startDateTimeLocal = new Date(
            parsedEventDate.getFullYear(), 
            parsedEventDate.getMonth(), 
            parsedEventDate.getDate(), 
            parsedTime!.hours, 
            parsedTime!.minutes, 
            parsedTime!.seconds
          );
          
          // Convert the floating local time to a UTC time string
          const startInUserTZ = formatToTimeZone(startDateTimeLocal, userTimeZone, "yyyy-MM-dd'T'HH:mm:ss");
          const endDateTime = new Date(startDateTimeLocal.getTime() + 60 * 60 * 1000) // Default 1 hour duration
          const endInUserTZ = formatToTimeZone(endDateTime, userTimeZone, "yyyy-MM-dd'T'HH:mm:ss");

          calendarEvent.start = {
            dateTime: startInUserTZ,
            timeZone: userTimeZone,
          }
          calendarEvent.end = {
            dateTime: endInUserTZ,
            timeZone: userTimeZone,
          }

        } else {
          // All-day event
          const endDate = new Date(eventStartDay)
          endDate.setDate(eventStartDay.getDate() + 1)
          
          calendarEvent.start = {
            date: format(eventStartDay, 'yyyy-MM-dd'),
          }
          calendarEvent.end = {
            date: format(endDate, 'yyyy-MM-dd'),
          }
        }

        // --- Insert Event ---
        await calendar.events.insert({
          calendarId: 'primary',
          requestBody: calendarEvent,
        })

        scheduledCount++
      } catch (error) {
        console.error(`Error processing event ${event.title}:`, error)
        skippedCount++
      }
    }

    return NextResponse.json({
      scheduledCount,
      skippedCount,
      message:
        scheduledCount > 0
          ? `Successfully scheduled ${scheduledCount} event(s)`
          : 'No valid events were found to schedule for today or the future.',
    })
  } catch (error) {
    console.error('Fatal Error in POST /api/calendar:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to schedule events' },
      { status: 500 }
    )
  }
}