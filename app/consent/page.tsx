'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ConsentPage() {
  const router = useRouter()

  useEffect(() => {
    // Consent is now handled through membership invites
    // Redirect to login
    router.push('/login')
  }, [router])

  return <main className="p-6 text-slate-400">Redirecting...</main>
}
