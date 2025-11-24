// src/app/api/analyze/route.ts

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { GoogleGenerativeAI } from '@google/generative-ai'

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
    const { emails } = await request.json()

    if (!emails || emails.length === 0) {
      return NextResponse.json(
        { error: 'No emails provided' },
        { status: 400 }
      )
    }

    const supabase = await getSupabaseClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      )
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    // Build email content
    const emailContent = emails
      .map(
        (email: any, idx: number) =>
          `Email ${idx + 1}:\nSubject: ${email.subject}\nFrom: ${email.from}\nContent:\n${email.text}`
      )
      .join('\n\n---\n\n')

    console.log(`📊 Analyzing ${emails.length} email(s)`)

    const prompt = `You are analyzing school/educational emails to extract important dates, times, events, deadlines, and announcements.

IMPORTANT: Today's date is November 24, 2025. When you see dates like "Nov 26" or "November 26" without a year specified, assume they mean 2025-11-26 (the current year), NOT 2024. Always use year 2025 for dates in November and December unless the email explicitly mentions a different year.

Emails to analyze:
${emailContent}

For EACH significant item found, extract:
1. Title (short name of event/deadline)
2. Date (MUST be in YYYY-MM-DD format - use 2025 as current year)
3. Time (in HH:MM format like 14:30 for 2:30 PM, or leave empty for all-day)
4. Description (2-3 sentences)
5. Location (if mentioned)
6. People involved (array of names)
7. Actions required (array of actions)
8. Important notes/reminders
9. Category (must be one of: Events, Deadlines, Schedule changes, Student updates, General info)

CRITICAL REMINDERS:
- Today is 2025-11-24
- Use 2025 for all dates unless explicitly stated otherwise
- Always use YYYY-MM-DD format for dates

Return ONLY a valid JSON object with this structure (no markdown, no code blocks):
{
  "summary": "Brief overview of what was found",
  "items": [
    {
      "title": "Event Name",
      "date": "2025-11-26",
      "time": "15:00",
      "description": "Description",
      "location": null,
      "peopleInvolved": [],
      "actionsRequired": [],
      "importantNotes": null,
      "category": "Events"
    }
  ],
  "events": []
}`

    console.log('🤖 Sending to Gemini...')

    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    console.log('✅ Gemini response received')

    let analysisData
    try {
      analysisData = JSON.parse(responseText)
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        analysisData = JSON.parse(jsonMatch[0])
      } else {
        return NextResponse.json(
          { error: 'Failed to parse analysis results' },
          { status: 500 }
        )
      }
    }

    const categoryColorMap: { [key: string]: string } = {
      'Events': '#FF6B6B',
      'Deadlines': '#4ECDC4',
      'Schedule changes': '#45B7D1',
      'Student updates': '#FFA07A',
      'General info': '#98D8C8',
    }

    // Process items for display
    const classifiedItems = (analysisData.items || [])
      .filter((item: any) => item.title && item.date)
      .map((item: any) => ({
        title: item.title,
        description: item.description || '',
        date: item.date,
        time: item.time || null,
        location: item.location || null,
        peopleInvolved: item.peopleInvolved || [],
        actionsRequired: item.actionsRequired || [],
        reminder: item.importantNotes || null,
        importantNotes: item.importantNotes || null,
        group: item.category || 'General info',
        color: categoryColorMap[item.category] || '#98D8C8',
      }))

    // Build events for calendar
    const events = classifiedItems.map((item: any) => ({
      title: item.title,
      description: item.description,
      date: item.date,
      time: item.time,
      location: item.location,
      category: item.group,
    }))

    console.log(`📋 Built ${events.length} events for calendar`)
    console.log(`Sample event:`, events[0] || 'No events')

    const summary =
      analysisData.summary ||
      `Analyzed ${emails.length} email(s) and extracted ${classifiedItems.length} items.`

    console.log(`✅ Analysis complete: ${classifiedItems.length} items extracted`)

    return NextResponse.json({
      summary,
      classifiedItems,
      events,
    })
  } catch (error) {
    console.error('Error in analyze:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    )
  }
}