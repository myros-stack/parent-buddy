'use client'

import { supabase } from '@/lib/supabaseClient'

export default function LoginPage() {
  const handleGoogleSignIn = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: [
            'email',
            'openid',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/calendar.events',
          ].join(' '),
        },
      })

      if (error) {
        console.error('Google sign-in error:', error.message)
        alert(`Sign-in failed: ${error.message}`)
      }
    } catch (err) {
      console.error('Unexpected error during sign-in:', err)
      alert('An unexpected error occurred. Check console for details.')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-3xl mb-6">Sign in to Myros.ai</h1>
      <button
        onClick={handleGoogleSignIn}
        className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
      >
        Sign in with Google
      </button>
    </div>
  )
}
