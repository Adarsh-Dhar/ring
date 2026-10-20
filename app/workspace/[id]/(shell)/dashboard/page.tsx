'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useWorkspace } from '../WorkspaceContext'
import { useDashboardData } from '../useDashboardData'

export default function DashboardPage() {
  const { workspaceId, isResidentView, href } = useWorkspace()
  const { data: dashboardData, reload } = useDashboardData(workspaceId)
  const [showRingModal, setShowRingModal] = useState(false)
  const [ringInstructions, setRingInstructions] = useState<any>(null)
  const [now, setNow] = useState(Date.now())

  // Update the countdown every second
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Reload dashboard data every 10 seconds to sync with server
  useEffect(() => {
    const interval = setInterval(() => {
      reload()
    }, 10000)
    return () => clearInterval(interval)
  }, [reload])

  const ringStatus = dashboardData?.ringStatus === 'connected' ? 'connected' : 'not_connected'

  const checkRingStatus = async () => {
    try {
      const res = await fetch('/api/ring/initiate-link')
      if (res.ok) {
        const data = await res.json()
        setRingInstructions(data)
        setShowRingModal(true)
      }
    } catch (e) {
      console.error('Failed to check Ring status', e)
    }
  }

  const handleConnectRing = () => {
    checkRingStatus()
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">What do you need?</h2>
      <p className="text-gray-600 mb-8">Choose an option to get started</p>

      {/* Pending Doorbell Alerts - Urgent */}
      {dashboardData?.pendingCases && dashboardData.pendingCases.length > 0 && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 mb-8">
          <div className="flex items-center mb-4">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mr-3">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-red-900">Someone needs your attention!</h3>
              <p className="text-red-700 text-sm">{dashboardData.pendingCases.length} pending alert{dashboardData.pendingCases.length > 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="space-y-3">
            {dashboardData.pendingCases.map((pendingCase) => (
              <div
                key={pendingCase.id}
                className="flex items-center justify-between p-4 bg-white rounded-lg border border-red-200"
              >
                <div className="flex items-center space-x-3">
                  <div className="text-2xl">🚪</div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {pendingCase.kind === 'visitor' ? 'Someone at the door' : 'Alert'}
                    </p>
                    {pendingCase.kind === 'visitor' && (
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                        pendingCase.riskLevel === 'high' ? 'bg-red-600 text-white'
                        : pendingCase.riskLevel === 'medium' ? 'bg-amber-500 text-black'
                        : pendingCase.riskLevel === 'low' ? 'bg-slate-500 text-white'
                        : pendingCase.riskLevel === 'none' ? 'bg-emerald-600 text-white'
                        : 'bg-slate-300 text-slate-800'}`}>
                        {pendingCase.riskLevel ? `Risk: ${pendingCase.riskLevel.toUpperCase()}` : 'Risk: checking…'}
                        {pendingCase.interrogationState === 'asking' || pendingCase.interrogationState === 'listening' ? ' (live)' : ''}
                      </span>
                    )}
                    <p className="text-sm text-gray-600">
                      {new Date(pendingCase.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">
                    Expires in {Math.max(0, Math.ceil((new Date(pendingCase.deadlineAt).getTime() - now) / 1000))}s
                  </p>
                  <Link
                    href="/helper"
                    className="inline-block mt-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Respond →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Action Cards */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Get Help Card */}
        <Link
          href="/helper"
          className="bg-white rounded-xl shadow-md p-8 hover:shadow-lg transition-shadow border-2 border-transparent hover:border-blue-300"
        >
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-gray-900 mb-2">Get help</h3>
              <p className="text-gray-600">Ask someone for help when you need it</p>
            </div>
          </div>
        </Link>

        {/* Visits Card */}
        <Link
          href={href('/add-visitor')}
          className="bg-white rounded-xl shadow-md p-8 hover:shadow-lg transition-shadow border-2 border-transparent hover:border-green-300"
        >
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-gray-900 mb-2">Visits</h3>
              <p className="text-gray-600">Plan or check a scheduled visit</p>
            </div>
          </div>
        </Link>

        {/* My People Card */}
        {isResidentView ? (
          <Link
            href={href('/helpers')}
            className="bg-white rounded-xl shadow-md p-8 hover:shadow-lg transition-shadow border-2 border-transparent hover:border-purple-300"
          >
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900 mb-2">My people</h3>
                <p className="text-gray-600">See your trusted helpers</p>
              </div>
            </div>
          </Link>
        ) : (
          <Link
            href={href('/add-helper')}
            className="bg-white rounded-xl shadow-md p-8 hover:shadow-lg transition-shadow border-2 border-transparent hover:border-purple-300"
          >
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900 mb-2">My people</h3>
                <p className="text-gray-600">Manage helpers for this household</p>
              </div>
            </div>
          </Link>
        )}

        {/* My Requests Card */}
        <Link
          href={href('/visitors')}
          className="bg-white rounded-xl shadow-md p-8 hover:shadow-lg transition-shadow border-2 border-transparent hover:border-orange-300"
        >
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-gray-900 mb-2">My requests</h3>
              <p className="text-gray-600">Check request and visitor pass status</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Quick Stats */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{dashboardData?.pendingAlerts ?? 0}</div>
            <div className="text-sm text-gray-600">Pending Alerts</div>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{dashboardData?.scheduledVisits ?? 0}</div>
            <div className="text-sm text-gray-600">Visits Today</div>
          </div>
          <div className="text-center p-4 bg-purple-50 rounded-lg">
            <div className="text-2xl font-bold text-purple-600">{dashboardData?.activePasses ?? 0}</div>
            <div className="text-sm text-gray-600">Active Passes</div>
          </div>
          <div
            className="text-center p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100"
            onClick={ringStatus !== 'connected' ? handleConnectRing : undefined}
          >
            <div className={`text-lg font-bold ${ringStatus === 'connected' ? 'text-green-600' : 'text-gray-500'}`}>
              {ringStatus === 'connected' ? '✓ Connected' : 'Not connected'}
            </div>
            <div className="text-sm text-gray-600">Ring Doorbell</div>
          </div>
        </div>
      </div>

      {/* Ring Connection Modal */}
      {showRingModal && ringInstructions && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold mb-4">Connect Ring Account</h3>
            {ringInstructions.status === 'ready_to_claim' ? (
              <>
                <p className="text-gray-700 mb-4">{ringInstructions.message}</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => window.location.href = ringInstructions.setupUrl}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                  >
                    Go to Setup Page
                  </button>
                  <button
                    onClick={() => setShowRingModal(false)}
                    className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-gray-700 mb-4">{ringInstructions.message}</p>
                <ol className="list-decimal list-inside mb-4 space-y-2">
                  {ringInstructions.instructions?.map((instruction: string, index: number) => (
                    <li key={index} className="text-gray-600">{instruction}</li>
                  ))}
                </ol>
                <div className="flex gap-3">
                  <button
                    onClick={() => window.open(ringInstructions.portalUrl, '_blank', 'noopener')}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                  >
                    Open Ring Portal
                  </button>
                  <button
                    onClick={() => {
                      setShowRingModal(false)
                      reload()
                    }}
                    className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300"
                  >
                    Check Status
                  </button>
                  <button
                    onClick={() => setShowRingModal(false)}
                    className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
