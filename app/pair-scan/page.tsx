'use client'

import { useRouter } from 'next/navigation'

export default function PairScanPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center mb-6">Pairing Device</h1>

        <div className="text-center py-8">
          <div className="text-6xl mb-4">🔧</div>
          <p className="text-lg font-semibold text-gray-700">QR Pairing Not Yet Implemented</p>
          <p className="text-sm text-gray-500 mt-2">This feature is part of Phase 1 of the v2 migration.</p>
          <p className="text-sm text-gray-500 mt-4">Please use the manual pairing code instead.</p>
          <button
            onClick={() => router.push('/pair')}
            className="mt-6 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            Go to Manual Pairing
          </button>
        </div>
      </div>
    </div>
  )
}
