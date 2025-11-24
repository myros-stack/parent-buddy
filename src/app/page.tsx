'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// --- Initialize Supabase Client (Must be process.env for deployment) ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [allowedSources, setAllowedSources] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  // --- Auth Listener ---
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: any } }) => {
      setUser(user);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event: string, session: any) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // --- Settings Logic ---
  const loadSettings = useCallback(async () => {
    if (!user) return;

    try {
      const res = await fetch('/api/settings');
      const data = await res.json();

      if (res.ok && data.allowedSources) {
        setAllowedSources(data.allowedSources);
      } else if (!res.ok) {
        console.warn('Failed to load settings:', data.error);
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }, [user]);

  const handleSaveSettings = async () => {
    setSaveStatus('saving');
    setSaveError('');

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedSources }),
      });

      const data = await res.json();

      if (res.ok) {
        setSaveStatus('saved');
        setSaveError('');
        // Auto-dismiss success message after 3 seconds
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
        setSaveError(data.error || 'Failed to save filters.');
        console.error('Save settings error:', data);
      }
    } catch (e) {
      setSaveStatus('error');
      setSaveError(
        e instanceof Error ? e.message : 'An unexpected error occurred.'
      );
      console.error('Save settings exception:', e);
    }
  };

  useEffect(() => {
    if (user) {
      // Initialize user profile on first login
      fetch('/api/init-profile', { method: 'POST' })
        .then((res) => res.json())
        .then((data) => {
          console.log('Profile initialized:', data);
          // Then load settings
          loadSettings();
        })
        .catch((e) => console.error('Failed to initialize profile:', e));
    }
  }, [user, loadSettings]);

  // --- The Core Three-Step Analysis Workflow ---
  const handleAnalyze = async () => {
    setLoading(true);
    setResult('');

    try {
      // STEP 1: Fetch Emails
      const emailRes = await fetch(
        `/api/emails?sources=${encodeURIComponent(allowedSources)}`
      );
      const emailData = await emailRes.json();

      if (emailData.error) {
        setResult(`Error fetching emails: ${emailData.error}`);
        setLoading(false);
        return;
      }
      if (emailData.emails.length === 0) {
        setResult(
          `No emails found matching the sources: ${allowedSources}. Please check your filters.`
        );
        setLoading(false);
        return;
      }

      // STEP 2: Analyze Emails (Returns JSON {summary, events} from /api/analyze)
      const analyzeRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: emailData.emails }),
      });
      const analyzedData = await analyzeRes.json();

      if (analyzedData.error) {
        setResult(`Error during analysis: ${analyzedData.error}`);
        setLoading(false);
        return;
      }

      // STEP 3: Schedule Calendar Events (NEW STEP!)
      const calendarRes = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: analyzedData.events,
          summary: analyzedData.summary,
        }),
      });
      const calendarData = await calendarRes.json();

      // Final Result Display
      let finalMessage = analyzedData.summary || 'Analysis complete.';

      if (calendarData.scheduledCount > 0) {
        finalMessage += `\n\n✅ **SUCCESS:** ${calendarData.scheduledCount} item(s) successfully added to your Google Calendar.`;
      } else if (calendarData.message) {
        finalMessage += `\n\nℹ️ Calendar Status: ${calendarData.message}`;
      }

      setResult(finalMessage);
    } catch (e) {
      setResult(
        `An unexpected error occurred: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    // --- SIGN-IN UI ---
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
        <h1 className="text-3xl font-bold mb-4 text-blue-700">Parent Buddy</h1>
        <p className="mb-6 text-gray-600 text-center">
          Please sign in to access your email analysis and scheduling tool.
        </p>
        <button
          onClick={() =>
            supabase.auth.signInWithOAuth({
              provider: 'google',
              options: {
                // CRITICAL: Request both Gmail and Calendar access
                scopes: [
                  'email',
                  'openid',
                  'https://www.googleapis.com/auth/gmail.readonly',
                  'https://www.googleapis.com/auth/calendar.events', // Required for scheduling
                ],
              },
            })
          }
          className="px-6 py-3 bg-violet-600 text-white font-medium rounded-lg shadow-lg hover:bg-violet-700 transition duration-150"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  // --- MAIN APP UI ---
  return (
    <main className="min-h-screen bg-gray-100 p-8 sm:p-12">
      <header className="flex justify-between items-center mb-8 pb-4 border-b border-gray-300">
        <h1 className="text-3xl font-bold text-blue-700">Parent Buddy</h1>
        <div className="text-sm text-gray-600">
          Logged in as: <span className="font-semibold text-blue-600">{user.email}</span>
          <button
            onClick={() => supabase.auth.signOut()}
            className="ml-4 text-red-500 hover:text-red-700 transition duration-150"
          >
            Logout
          </button>
        </div>
      </header>

      <p className="text-xl font-light text-gray-600 mb-8">
        We'll find the dates, tasks, and key announcements from your filtered
        emails and schedule them automatically.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 shadow-xl rounded-xl">
          <h2 className="text-xl font-semibold mb-4 text-blue-700 flex items-center">
            1. Configure Filters & Analyze
          </h2>

          <label className="block text-sm font-medium text-gray-700 mb-1">
            Allowed Sender Domains/Emails (comma-separated):
          </label>
          <div className="flex space-x-2 mb-4">
            <input
              type="text"
              className="flex-grow p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-600 transition duration-150"
              placeholder="e.g., school.edu, teacher@gmail.com"
              value={allowedSources}
              onChange={(e) => {
                setAllowedSources(e.target.value);
                setSaveStatus('idle');
                setSaveError('');
              }}
            />
            <button
              onClick={handleSaveSettings}
              disabled={saveStatus === 'saving'}
              className={`px-4 py-3 rounded-lg text-white font-medium transition duration-150 ${
                saveStatus === 'saving'
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-violet-600 hover:bg-violet-700'
              }`}
            >
              {saveStatus === 'saving' ? 'Saving...' : 'Save Filters'}
            </button>
          </div>

          {saveStatus === 'saved' && (
            <p className="text-sm text-green-600 mb-4">
              ✅ Filters saved successfully!
            </p>
          )}
          {saveStatus === 'error' && (
            <p className="text-sm text-red-600 mb-4">
              ❌ {saveError || 'Failed to save filters.'}
            </p>
          )}

          <button
            onClick={handleAnalyze}
            disabled={loading || allowedSources.length === 0}
            className={`w-full py-3 mt-4 rounded-lg text-white font-semibold transition duration-150 ${
              loading || allowedSources.length === 0
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 shadow-md'
            }`}
          >
            {loading ? 'Analyzing & Scheduling...' : 'Analyze & Schedule Emails Now'}
          </button>
        </div>

        <div className="bg-white p-6 shadow-xl rounded-xl">
          <h2 className="text-xl font-semibold mb-4 text-blue-700">
            2. Extracted Items & Calendar Status
          </h2>
          <div className="min-h-[200px] border border-gray-300 rounded-lg p-4 bg-gray-50 whitespace-pre-wrap">
            {loading ? (
              <p className="text-gray-500">
                Processing, analyzing, and scheduling items...
              </p>
            ) : result ? (
              <p className="text-gray-800">{result}</p>
            ) : (
              <p className="text-gray-500">
                Results and scheduling status will appear here...
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}