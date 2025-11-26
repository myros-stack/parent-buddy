// src/app/api/emails/route.ts

export const dynamic = 'force-dynamic';

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const sources = searchParams.get('sources') || ''

    const supabase = await getSupabaseClient()

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.provider_token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: session.provider_token })

    const gmail = google.gmail({ version: 'v1', auth })

    const sourceList = sources
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s)
    const queryParts = sourceList.map((source) => `from:"${source}"`)
    const query = queryParts.join(' OR ')

    if (!query) {
      return NextResponse.json({ emails: [] })
    }

    console.log(`📧 Fetching emails with query: ${query}`)

    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 10,
    })

    const messages = res.data.messages || []
    console.log(`📊 Found ${messages.length} emails`)

    const emails = []

    for (const message of messages) {
      try {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
          format: 'full',
        })

        const headers = msg.data.payload?.headers || []
        const subject =
          headers.find((h) => h.name === 'Subject')?.value || 'No Subject'
        const from = headers.find((h) => h.name === 'From')?.value || 'Unknown'

        let emailBody = ''

        if (msg.data.payload?.parts) {
          const textPart = msg.data.payload.parts.find(
            (part: any) => part.mimeType === 'text/plain'
          )
          if (textPart?.body?.data) {
            emailBody = Buffer.from(textPart.body.data, 'base64')
              .toString('utf-8')
              .substring(0, 3000)
          }
        } else if (msg.data.payload?.body?.data) {
          emailBody = Buffer.from(msg.data.payload.body.data, 'base64')
            .toString('utf-8')
            .substring(0, 3000)
        }

        emails.push({
          id: message.id,
          subject,
          from,
          text: emailBody,
        })
      } catch (error) {
        console.error(`Error processing message:`, error)
      }
    }

    console.log(`✅ Successfully processed ${emails.length} emails\n`)

    return NextResponse.json({ emails })
  } catch (error) {
    console.error('Error in GET /api/emails:', error)
    return NextResponse.json(
      { error: 'Failed to fetch emails' },
      { status: 500 }
    )
  }
}