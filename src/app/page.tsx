'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [classifiedItems, setClassifiedItems] = useState<any[]>([]);
  const [allowedSources, setAllowedSources] = useState(''); 
  const [filterHistory, setFilterHistory] = useState<any[]>([]); 
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [editingFilterId, setEditingFilterId] = useState<string | null>(null);
  const [editingFilterValue, setEditingFilterValue] = useState('');

  const supabase = createClient();

  // --- Helper function to get local timezone ---
  const getLocalTimezone = (): string => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (e) {
      return 'UTC';
    }
  };

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
  }, [supabase]);

  // --- Load settings ---
  const loadSettings = useCallback(async () => {
    if (!user) return;

    try {
      const res = await fetch('/api/settings');
      const data = await res.json();

      if (res.ok) {
        if (data.filterHistory && data.filterHistory.length > 0) {
          setFilterHistory(data.filterHistory);
        } else if (data.allowedSources) {
          setAllowedSources(data.allowedSources);
        } else {
          setAllowedSources('');
        }
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }, [user]);

  // --- Save settings ---
  const handleSaveSettings = async () => {
    if (!allowedSources.trim()) return;

    setSaveStatus('saving');
    setSaveError('');

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedSources: allowedSources.trim() }),
      });

      const data = await res.json();

      if (res.ok) {
        setSaveStatus('saved');
        setSaveError('');
        setAllowedSources('');
        setTimeout(() => setSaveStatus('idle'), 3000);
        loadSettings();
      } else {
        setSaveStatus('error');
        setSaveError(data.error || 'Failed to save filters.');
      }
    } catch (e) {
      setSaveStatus('error');
      setSaveError(e instanceof Error ? e.message : 'An unexpected error occurred.');
    }
  };

  // --- Edit filter ---
  const handleEditFilter = (filterId: string, filterValue: string) => {
    setEditingFilterId(filterId);
    setEditingFilterValue(filterValue);
  };

  // --- Save edit ---
  const handleSaveEdit = async (filterId: string) => {
    if (!editingFilterValue.trim()) return;

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterId, newFilterValue: editingFilterValue.trim() }),
      });

      if (res.ok) {
        setEditingFilterId(null);
        setEditingFilterValue('');
        loadSettings();
      } else {
        console.error('Failed to save edit:', await res.json());
      }
    } catch (e) {
      console.error('Failed to save edit:', e);
    }
  };

  // --- Delete filter ---
  const handleDeleteFilter = async (filterId: string) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterId }),
      });

      if (res.ok) {
        loadSettings();
      }
    } catch (e) {
      console.error('Failed to delete filter:', e);
    }
  };

  const handleCancelEdit = () => {
    setEditingFilterId(null);
    setEditingFilterValue('');
  };

  // --- Initialize profile and load settings ---
  useEffect(() => {
    if (user) {
      fetch('/api/init-profile', { method: 'POST' })
        .then((res) => res.json())
        .then(() => {
          loadSettings();
        })
        .catch((e) => console.error('Failed to initialize profile:', e));
    }
  }, [user, loadSettings]);

  // --- Get sources for analysis ---
  const getSourcesForAnalysis = (): string => {
    if (allowedSources.trim()) {
      return allowedSources.trim();
    }
    if (filterHistory.length > 0) {
      return filterHistory[0].filters || '';
    }
    return '';
  };

  // --- Main analysis workflow ---
  const handleAnalyze = async () => {
    const sourcesToUse = getSourcesForAnalysis();

    if (!sourcesToUse) {
      setResult('Please add a filter first.');
      return;
    }

    setLoading(true);
    setResult('');
    setClassifiedItems([]);

    try {
      // STEP 1: Fetch Emails
      const emailRes = await fetch(
        `/api/emails?sources=${encodeURIComponent(sourcesToUse)}`
      );
      const emailData = await emailRes.json();

      if (emailData.error) {
        setResult(`Error fetching emails: ${emailData.error}`);
        setLoading(false);
        return;
      }
      if (emailData.emails.length === 0) {
        setResult(
          `No emails found matching the sources: ${sourcesToUse}. Please check your filters.`
        );
        setLoading(false);
        return;
      }

      // STEP 2: Analyze Emails
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

      setClassifiedItems(analyzedData.events || []);

      // STEP 3: Schedule Calendar Events with timezone
      const userTimeZone = getLocalTimezone();

      const calendarRes = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: analyzedData.events,
          summary: analyzedData.summary,
          userTimeZone: userTimeZone,
        }),
      });
      const calendarData = await calendarRes.json();

      let finalMessage = analyzedData.summary || 'Analysis complete.';

      if (calendarData.scheduledCount > 0) {
        finalMessage += `\n\n✅ **SUCCESS:** ${calendarData.scheduledCount} item(s) successfully added to your Google Calendar.`;
      } else if (calendarData.message) {
        finalMessage += `\n\nℹ️ Calendar Status: ${calendarData.message}`;
      }

      setResult(finalMessage);
    } catch (e) {
      setResult(
        `An unexpected error occurred: ${e instanceof Error ? e.message : String(e)}`
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
                scopes: 'email openid https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events',
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
        {/* Left Panel: Filters & Analysis */}
        <div className="bg-white p-6 shadow-xl rounded-xl">
          <h2 className="text-xl font-semibold mb-4 text-blue-700">
            1. Configure Filters & Analyze
          </h2>

          <label className="block text-sm font-medium text-gray-700 mb-2">
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
              disabled={saveStatus === 'saving' || !allowedSources.trim()}
              className={`px-4 py-3 rounded-lg text-white font-medium transition duration-150 ${
                saveStatus === 'saving' || !allowedSources.trim()
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-violet-600 hover:bg-violet-700'
              }`}
            >
              {saveStatus === 'saving' ? 'Saving...' : 'Save Filters'}
            </button>
          </div>

          {saveStatus === 'saved' && (
            <p className="text-sm text-green-600 mb-4">✅ Filters saved successfully!</p>
          )}
          {saveStatus === 'error' && (
            <p className="text-sm text-red-600 mb-4">❌ {saveError}</p>
          )}

          {/* Saved Filters List */}
          {filterHistory.length > 0 && (
            <div className="mb-6">
              <h3 className="text-md font-semibold text-gray-700 mb-2">Saved Filters:</h3>
              <div className="space-y-2">
                {filterHistory.map((filter) => (
                  <div key={filter.id} className="flex items-center justify-between p-3 bg-gray-50 rounded border border-gray-200 group hover:bg-gray-100 transition">
                    {editingFilterId === filter.id ? (
                      <div className="flex-1 flex space-x-2">
                        <input
                          type="text"
                          className="flex-1 p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-violet-600"
                          value={editingFilterValue}
                          onChange={(e) => setEditingFilterValue(e.target.value)}
                        />
                        <button
                          onClick={() => handleSaveEdit(filter.id)}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition"
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white text-sm rounded transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm text-gray-800">{filter.filters}</span>
                        <div className="flex space-x-3 opacity-0 group-hover:opacity-100 transition">
                          <button
                            onClick={() => handleEditFilter(filter.id, filter.filters)}
                            className="text-blue-500 hover:text-blue-700 hover:scale-110 transition"
                            title="Edit filter"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDeleteFilter(filter.id)}
                            className="text-red-500 hover:text-red-700 hover:scale-110 transition"
                            title="Delete filter"
                          >
                            🗑️
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleAnalyze}
            disabled={loading || (allowedSources.length === 0 && filterHistory.length === 0)}
            className={`w-full py-3 rounded-lg text-white font-semibold transition duration-150 ${
              loading || (allowedSources.length === 0 && filterHistory.length === 0)
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 shadow-md'
            }`}
          >
            {loading ? 'Analyzing & Scheduling...' : 'Analyze & Schedule Emails Now'}
          </button>
        </div>

        {/* Right Panel: Results & Classified Items */}
        <div className="bg-white p-6 shadow-xl rounded-xl">
          <h2 className="text-xl font-semibold mb-4 text-blue-700">
            2. Extracted Items & Calendar Status
          </h2>
          <div className="space-y-4 max-h-[600px] overflow-y-auto">
            {loading ? (
              <p className="text-gray-500">Processing, analyzing, and scheduling items...</p>
            ) : result ? (
              <div>
                <p className="text-gray-800 mb-6 whitespace-pre-wrap">{result}</p>

                {classifiedItems.length > 0 && (
                  <div className="space-y-4 border-t pt-6">
                    <h3 className="font-semibold text-gray-700 mb-4">📋 Classified Items:</h3>
                    {classifiedItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="border-l-4 p-4 bg-gray-50 rounded"
                        style={{ borderColor: item.color || '#3b82f6' }}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-gray-800">{item.title}</h4>
                          <span
                            className="px-2 py-1 text-xs rounded text-white"
                            style={{ backgroundColor: item.color || '#3b82f6' }}
                          >
                            {item.group || item.type}
                          </span>
                        </div>

                        <p className="text-sm text-gray-700 mb-2">{item.description}</p>

                        <div className="text-xs text-gray-600 space-y-1">
                          {item.date && (
                            <div>
                              📅 <strong>Date:</strong> {item.date}
                              {item.time && ` at ${item.time}`}
                            </div>
                          )}
                          {item.location && (
                            <div>📍 <strong>Location:</strong> {item.location}</div>
                          )}
                          {item.peopleInvolved && item.peopleInvolved.length > 0 && (
                            <div>👥 <strong>People:</strong> {item.peopleInvolved.join(', ')}</div>
                          )}
                          {item.actionsRequired && item.actionsRequired.length > 0 && (
                            <div>✓ <strong>Actions:</strong> {item.actionsRequired.join(', ')}</div>
                          )}
                          {item.reminder && (
                            <div>🔔 <strong>Reminder:</strong> {item.reminder}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500">Results and scheduling status will appear here...</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}