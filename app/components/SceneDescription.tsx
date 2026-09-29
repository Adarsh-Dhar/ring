import { useState } from 'react'

interface SceneAnalysis {
  narration: string
  activity: string
  people_count: number
  threat_level: 'low' | 'medium' | 'high'
  reason: string
}

interface SceneDescriptionProps {
  latest: SceneAnalysis | null
  history: SceneAnalysis[]
  analyzing: boolean
  error: string | null
  enabled: boolean
  onToggle: (enabled: boolean) => void
  retryCount?: number
}

export function SceneDescription({
  latest,
  history,
  analyzing,
  error,
  enabled,
  onToggle,
  retryCount = 0
}: SceneDescriptionProps) {
  const [showHistory, setShowHistory] = useState(false)

  const getThreatColor = (level: string) => {
    switch (level) {
      case 'high': return 'text-red-400 bg-red-400/10'
      case 'medium': return 'text-yellow-400 bg-yellow-400/10'
      case 'low': return 'text-green-400 bg-green-400/10'
      default: return 'text-slate-400 bg-slate-400/10'
    }
  }

  const getThreatIcon = (level: string) => {
    switch (level) {
      case 'high': return '⚠️'
      case 'medium': return '⚡'
      case 'low': return '✓'
      default: return '?'
    }
  }

  return (
    <div className="mt-4 bg-dash-card rounded-xl p-4 border border-slate-700">
      {/* Header with toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-slate-300">AI Scene Analysis</h3>
          {analyzing && (
            <span className="text-xs text-dash-cyan animate-pulse">Analyzing...</span>
          )}
        </div>
        <button
          onClick={() => onToggle(!enabled)}
          className={`text-xs px-3 py-1 rounded-full transition ${
            enabled 
              ? 'bg-dash-cyan text-black font-medium' 
              : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
          }`}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-3 p-2 bg-yellow-400/10 border border-yellow-400/30 rounded">
          <p className="text-xs text-yellow-400">{error}</p>
          {retryCount > 0 && (
            <p className="text-xs text-yellow-500 mt-1">Retry attempt {retryCount} - will back off automatically</p>
          )}
        </div>
      )}

      {/* Latest analysis */}
      {latest && enabled && (
        <div className="space-y-3">
          {/* Threat level badge */}
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${getThreatColor(latest.threat_level)}`}>
              {getThreatIcon(latest.threat_level)} {latest.threat_level.toUpperCase()} THREAT
            </span>
            <span className="text-xs text-slate-500">
              {latest.people_count} person{latest.people_count !== 1 ? 's' : ''} detected
            </span>
          </div>

          {/* Narration */}
          <div>
            <p className="text-sm text-slate-300">{latest.narration}</p>
          </div>

          {/* Activity and reason */}
          <div className="flex gap-4 text-xs">
            <div>
              <span className="text-slate-500">Activity:</span>
              <span className="ml-1 text-slate-300">{latest.activity}</span>
            </div>
            <div className="flex-1">
              <span className="text-slate-500">Reason:</span>
              <span className="ml-1 text-slate-300">{latest.reason}</span>
            </div>
          </div>

          {/* History toggle */}
          {history.length > 1 && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-xs text-dash-cyan hover:underline"
            >
              {showHistory ? 'Hide' : 'Show'} history ({history.length - 1})
            </button>
          )}

          {/* History list */}
          {showHistory && history.length > 1 && (
            <div className="mt-3 space-y-2 max-h-40 overflow-y-auto">
              {history.slice(1).map((item, index) => (
                <div key={index} className="p-2 bg-slate-800/50 rounded text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-1.5 py-0.5 rounded ${getThreatColor(item.threat_level)}`}>
                      {item.threat_level}
                    </span>
                    <span className="text-slate-500">{item.activity}</span>
                  </div>
                  <p className="text-slate-400">{item.narration}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Disabled state */}
      {!enabled && (
        <p className="text-sm text-slate-500 italic">Analysis disabled. Toggle ON to enable AI scene description.</p>
      )}

      {/* No data yet */}
      {enabled && !latest && !analyzing && !error && (
        <p className="text-sm text-slate-500 italic">Waiting for analysis...</p>
      )}
    </div>
  )
}
