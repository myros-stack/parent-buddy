// src/app/api/emails/route.ts

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { google } from 'googleapis';
import { Buffer } from 'buffer';

let gmail: any;

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

// Helper: Decode Base64url to standard text
function decodeBase64Url(data: string): string {
    data = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(data, 'base64').toString('utf8');
}

// Helper: Extract Email Body
function getEmailBody(payload: any): string | null {
    if (!payload.parts) {
        if (payload.body && payload.body.data) {
            return decodeBase64Url(payload.body.data);
        }
        return null;
    }

    const parts = payload.parts;
    let bestPart: any = null;

    for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body.data) {
            bestPart = part;
            break;
        }
        if (part.mimeType === 'text/html' && part.body.data) {
            bestPart = part;
        }
    }

    if (bestPart && bestPart.body && bestPart.body.data) {
        return decodeBase64Url(bestPart.body.data);
    }

    for (const part of parts) {
        const body = getEmailBody(part);
        if (body) return body;
    }

    return null;
}


// --- Main GET Handler ---
export async function GET(request: Request) {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sourcesParam = searchParams.get('sources');

    if (!sourcesParam) {
        return NextResponse.json({ error: 'Sources parameter is required' }, { status: 400 });
    }

    const allowedSources = sourcesParam.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
    const gmailQuery = allowedSources.length > 0
        ? allowedSources.map(source => `from:(${source})`).join(' OR ')
        : 'in:inbox';

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session?.provider_token) {
        return NextResponse.json({ error: 'Failed to get session or provider token' }, { status: 401 });
    }

    const accessToken = session.provider_token;
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    gmail = google.gmail({ version: 'v1', auth });

    try {
        const messageListResponse = await gmail.users.messages.list({
            userId: 'me',
            q: gmailQuery,
            maxResults: 10,
        });

        const messages = messageListResponse.data.messages || [];

        if (messages.length === 0) {
            return NextResponse.json({ emails: [] });
        }

        const emailDetailsPromises = messages.map((message: any) =>
            gmail.users.messages.get({
                userId: 'me',
                id: message.id,
                format: 'full',
            })
        );

        const emailDetailsResponses = await Promise.all(emailDetailsPromises);
        
        const extractedEmails = emailDetailsResponses.map((res: any) => {
            const payload = res.data.payload;
            const bodyText = payload ? getEmailBody(payload) : null;
            
            if (!bodyText) return null;

            const headers: { [key: string]: string } = {};
            payload?.headers?.forEach((header: any) => {
                headers[header.name] = header.value;
            });

            return `
--- EMAIL START ---
Date: ${headers['Date'] || 'N/A'}
From: ${headers['From'] || 'N/A'}
Subject: ${headers['Subject'] || 'N/A'}

Body:
${bodyText}
--- EMAIL END ---
`;
        }).filter((email: any) => email !== null);


        return NextResponse.json({ emails: extractedEmails });

    } catch (error) {
        console.error('Error fetching emails from Gmail API:', error);
        return NextResponse.json({ error: 'Failed to communicate with Gmail API' }, { status: 500 });
    }
}