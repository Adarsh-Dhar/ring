'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [deviceAuth, setDeviceAuth] = useState<{ userCode: string; verificationUrl: string; deviceCode: string } | null>(null)
  const [pollingTokens, setPollingTokens] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const initiateAuth = async () => {
    // Clear any existing polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    setPollingTokens(false)
    setError('')

    try {
      const res = await fetch('/api/auth/device', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setDeviceAuth({
          userCode: data.userCode,
          verificationUrl: data.verificationUrl,
          deviceCode: data.deviceCode,
        })
        startPollingTokens(data.deviceCode, data.interval || 5)
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to initiate authentication')
      }
    } catch (e) {
      setError('An error occurred. Please try again.')
    }
  }

  const copyToClipboard = () => {
    if (deviceAuth) {
      navigator.clipboard.writeText(deviceAuth.userCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const startPollingTokens = async (deviceCode: string, interval: number) => {
    // Clear any existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    setPollingTokens(true)
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/auth/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceCode }),
        })
        const data = await res.json()

        if (data.success) {
          // Clear interval immediately on success
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }
          setPollingTokens(false)
          setDeviceAuth(null)

          // Check if user has a household
          const householdsRes = await fetch('/api/user/households')
          if (householdsRes.ok) {
            const householdsData = await householdsRes.json()
            if (householdsData.households && householdsData.households.length > 0) {
              // Redirect to first household as resident
              const residentHousehold = householdsData.households.find((h: any) => h.role === 'guardian')
              if (residentHousehold) {
                router.push(`/workspace/${residentHousehold.householdId}?role=resident`)
              } else {
                router.push('/select-workspace')
              }
            } else {
              router.push('/select-role')
            }
          } else {
            router.push('/select-role')
          }
        } else if (data.error === 'expired_token') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }
          setPollingTokens(false)
          setDeviceAuth(null)
          setError('Authorization expired. Please try again.')
        } else if (data.error === 'authorization_pending' || data.error === 'slow_down') {
          // Continue polling - these are expected states
        } else {
          // Other errors (like invalid_grant/device code already exchanged)
          // Stop polling and prompt user to try again
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }
          setPollingTokens(false)
          setDeviceAuth(null)
          setError('Authorization failed. Please try again.')
        }
      } catch (e) {
        console.error('Error polling for tokens', e)
      }
    }, interval * 1000)
  }

  useEffect(() => {
    initiateAuth()

    // Cleanup interval on unmount
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to Doorbell Helper
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Using your Google account
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {deviceAuth ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-900 mb-2">Connect Your Google Account</h3>
            <p className="text-blue-800 mb-4">
              Visit{' '}
              <a
                href={deviceAuth.verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
              >
                {deviceAuth.verificationUrl}
              </a>
              {' '}
              and enter this code:
            </p>
            <div className="bg-white border-2 border-blue-300 rounded-lg p-4 mb-4 flex items-center justify-between">
              <span className="text-3xl font-mono font-bold tracking-widest text-blue-900">
                {deviceAuth.userCode}
              </span>
              <button
                onClick={copyToClipboard}
                className="ml-4 p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-100 rounded-md transition-colors"
                title="Copy code"
              >
                {copied ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </div>
            {pollingTokens && (
              <p className="text-sm text-blue-700">Waiting for authorization...</p>
            )}
            <button
              onClick={initiateAuth}
              className="mt-4 text-sm text-blue-600 hover:text-blue-700 underline"
            >
              Start over
            </button>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <p>Initializing authentication...</p>
          </div>
        )}
      </div>
    </div>
  )
}
