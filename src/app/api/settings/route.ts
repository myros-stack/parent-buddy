// src/app/api/settings/route.ts

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

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

// GET handler to retrieve allowed sender domains
export async function GET() {
    try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from('profiles')
            .select('allowed_sources')
            .single();

        if (error) {
            console.error("Supabase error fetching settings:", error);
            return NextResponse.json({ error: 'Failed to load settings.' }, { status: 500 });
        }

        return NextResponse.json({ allowedSources: data.allowed_sources || '' });
    } catch (e) {
        console.error("General error in GET /api/settings:", e);
        return NextResponse.json({ error: 'Server error loading settings.' }, { status: 500 });
    }
}

// POST handler to save allowed sender domains
export async function POST(request: Request) {
    try {
        const { allowedSources } = await request.json();
        const supabase = getSupabaseClient();

        // Get the current user session/ID
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'User not authenticated.' }, { status: 401 });
        }

        const { error } = await supabase
            .from('profiles')
            .update({ allowed_sources: allowedSources })
            .eq('id', user.id);

        if (error) {
            console.error("Supabase error saving settings:", error);
            return NextResponse.json({ error: 'Failed to save settings to database.' }, { status: 500 });
        }

        return NextResponse.json({ message: 'Settings saved successfully.' });
    } catch (e) {
        console.error("General error in POST /api/settings:", e);
        return NextResponse.json({ error: 'Server error saving settings.' }, { status: 500 });
    }
}