'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const handleAuth = async () => {
      const { data: { session }, error } = await supabase.auth.getSessionFromUrl()
      
      if (error) {
        console.error('Error getting session:', error.message)
        router.push('/login')
        return
      }

      if (session) {
        // Optionally store session in localStorage or context here
        router.push('/dashboard') // Redirect after successful login
      } else {
        router.push('/login') // No session, redirect to login
      }
    }

    handleAuth()
  }, [router])

  return <p>Loading authentication...</p>
}
