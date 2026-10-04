'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PairQRPage() {
  const router = useRouter()
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadQRCode()
  }, [])

  const loadQRCode = async () => {
    try {
      const res = await fetch('/api/device/qr')
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to generate QR code')
        return
      }

      setQrCode(data.qrCode)
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center mb-6">Pair Resident Device</h1>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-500">Generating QR code...</p>
          </div>
        ) : qrCode ? (
          <div className="space-y-4">
            <div className="flex justify-center">
              <img src={qrCode} alt="Pairing QR Code" className="border-2 border-gray-200 rounded-lg" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm text-gray-600">
                Scan this QR code with the resident device to pair it.
              </p>
              <p className="text-xs text-gray-400">
                The QR code is valid for 5 minutes.
              </p>
            </div>
            <button
              onClick={loadQRCode}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
            >
              Refresh QR Code
            </button>
            <button
              onClick={() => router.push('/setup')}
              className="w-full text-gray-500 py-2 px-4 hover:text-gray-700 text-sm transition-colors"
            >
              ← Back to Settings
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
