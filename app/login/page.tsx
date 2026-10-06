'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next')
  const errorCode = searchParams.get('error')

  // Validate next parameter to prevent open redirects
  const getSafeRedirect = (nextParam: string | null): string => {
    if (!nextParam) return ''
    // Must start with / (relative path)
    if (!nextParam.startsWith('/')) return ''
    // Must not start with // (protocol-relative)
    if (nextParam.startsWith('//')) return ''
    // Must not contain a scheme (http://, https://, etc.)
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(nextParam)) return ''
    return nextParam
  }

  const safeNext = getSafeRedirect(next)

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const initiateGoogleAuth = () => {
    setLoading(true)
    const redirectUrl = safeNext ? `/api/auth/google/start?next=${encodeURIComponent(safeNext)}` : '/api/auth/google/start'
    window.location.href = redirectUrl
  }

  useEffect(() => {
    // Handle error messages from OAuth callback
    if (errorCode) {
      const errorMessages: Record<string, string> = {
        cancelled: 'You cancelled the sign-in process.',
        oauth_error: 'An error occurred during sign-in.',
        invalid_response: 'Invalid response from Google.',
        missing_state: 'Security error: missing state.',
        state_mismatch: 'Security error: state mismatch.',
        invalid_state: 'Security error: invalid state.',
        oauth_unavailable: 'Google OAuth is not available.',
        token_exchange_failed: 'Failed to exchange authorization code.',
        no_email: 'Google did not provide an email address.',
        email_not_verified: 'Your Google email is not verified.',
        session_creation_failed: 'Failed to create session.',
        server_error: 'A server error occurred.',
      }
      setMessage(errorMessages[errorCode] || 'An unknown error occurred.')
    }
  }, [errorCode])

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

        {message && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {message}
            <button
              onClick={() => setMessage('')}
              className="ml-2 text-red-800 hover:text-red-900 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <button
          onClick={initiateGoogleAuth}
          disabled={loading}
          className="w-full flex items-center justify-center px-4 py-3 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Signing in...
            </span>
          ) : (
            <span className="flex items-center">
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </span>
          )}
        </button>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="text-gray-600">Loading...</div></div>}>
      <LoginForm />
    </Suspense>
  )
}
