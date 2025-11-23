// src/app/api/calendar/route.ts

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { google } from 'googleapis';

// --- Initialize Supabase Server Client (FIXED COOKIES FUNCTION CALL) ---
function getSupabaseClient() {
    const cookieStore = cookies(); 
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { 
            cookies: { 
                get: (name: string) => cookieStore.get(name)?.value 
            } 
        }
    );
}

export async function POST(request: Request) {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.provider_token) {
        return NextResponse.json({ error: 'Authorization token not found.' }, { status: 401 });
    }
    
    try {
        const { events, summary } = await request.json(); 
        
        if (!events || events.length === 0) {
            return NextResponse.json({ message: "No events to schedule.", summary });
        }

        const accessToken = session.provider_token;
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });
        
        const calendar = google.calendar({ version: 'v3', auth });
        
        const promises = events.map((eventData: any) => {
            const isAllDay = eventData.date.length === 10; 
            
            const calendarEvent = {
                summary: eventData.title,
                description: eventData.description,
                start: {
                    date: isAllDay ? eventData.date : undefined,
                    dateTime: !isAllDay ? eventData.date : undefined,
                    timeZone: 'UTC', 
                },
                end: {
                    date: isAllDay ? eventData.date : undefined,
                    dateTime: !isAllDay ? eventData.date : undefined,
                    timeZone: 'UTC',
                },
            };

            return calendar.events.insert({
                calendarId: 'primary',
                requestBody: calendarEvent,
            });
        });

        await Promise.all(promises);

        return NextResponse.json({ 
            message: `Successfully scheduled ${promises.length} items to your calendar.`,
            summary: summary, 
            scheduledCount: promises.length
        });

    } catch (error) {
        console.error('Calendar API failed:', error);
        return NextResponse.json({ error: 'Failed to create calendar events.' }, { status: 500 });
    }
}