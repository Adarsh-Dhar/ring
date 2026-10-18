'use client'

import { useState, useEffect } from 'react'
import { DECISIONS, type Preferences, type Delegate } from '@/lib/doorstep/residentPreferences'

interface DelegationSettingsProps {
  householdId: string
}

export default function DelegationSettings({ householdId }: DelegationSettingsProps) {
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadPreferences()
  }, [householdId])

  const loadPreferences = async () => {
    try {
      const res = await fetch('/api/resident/delegation')
      if (res.ok) {
        const data = await res.json()
        setPrefs(data)
      }
    } catch (e) {
      console.error('[DELEGATION] Failed to load preferences:', e)
      setMessage('Failed to load preferences')
    }
  }

  const handleUpdate = async (decision: string, value: Delegate) => {
    if (!prefs) return

    const updated = {
      ...prefs,
      delegation: {
        ...prefs.delegation,
        [decision]: value,
      },
    }

    setSaving(true)
    setMessage('')

    try {
      const res = await fetch('/api/resident/delegation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: updated }),
      })

      if (res.ok) {
        const data = await res.json()
        setPrefs(data)
        setMessage('Saved successfully')
        setTimeout(() => setMessage(''), 2000)
      } else {
        setMessage('Failed to save preferences')
      }
    } catch (e) {
      console.error('[DELEGATION] Failed to save preferences:', e)
      setMessage('Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }

  if (!prefs) {
    return <div className="p-4">Loading...</div>
  }

  const decisionLabels: Record<string, string> = {
    greet_visitor: 'Greet visitor',
    ask_purpose: 'Ask visitor\'s purpose',
    ask_for_id: 'Ask for ID',
    tell_visitor_to_leave: 'Tell visitor to leave',
    accept_parcel: 'Accept deliveries',
    approve_short_notice: 'Approve short-notice visits',
  }

  const delegateLabels: Record<Delegate, string> = {
    ai: 'AI handles this',
    helper: 'Helper must approve',
    resident_only: 'Only I can decide',
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">Delegation Settings</h2>
      <p className="text-gray-600 mb-6">
        Choose who handles each decision. The AI can only act on decisions you delegate to it.
        Helpers always control decisions delegated to them. Safety rules (unlocking doors, disclosing credentials)
        are never permitted, regardless of these settings.
      </p>

      <div className="space-y-4">
        {DECISIONS.map((decision) => (
          <div key={decision} className="border rounded-lg p-4">
            <h3 className="font-semibold mb-3">{decisionLabels[decision]}</h3>
            <div className="space-y-2">
              {(Object.keys(delegateLabels) as Delegate[]).map((delegate) => (
                <label key={delegate} className="flex items-center space-x-3">
                  <input
                    type="radio"
                    name={decision}
                    value={delegate}
                    checked={prefs.delegation[decision] === delegate}
                    onChange={(e) => handleUpdate(decision, e.target.value as Delegate)}
                    disabled={saving}
                    className="w-4 h-4"
                  />
                  <span>{delegateLabels[delegate]}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {message && (
        <div className={`mt-4 p-3 rounded ${message.includes('Failed') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
          {message}
        </div>
      )}

      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <h4 className="font-semibold mb-2">Safety Information</h4>
        <p className="text-sm text-gray-600">
          These settings control who makes routine decisions. The following actions are never permitted,
          regardless of these settings: unlocking the door, disclosing access credentials, or compelling
          the resident to open the door. These are hard safety rules that protect you.
        </p>
      </div>
    </div>
  )
}
