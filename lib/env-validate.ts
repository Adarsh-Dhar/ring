/**
 * Environment variable validation utility.
 * Checks required and optional environment variables at startup.
 */

type EnvVarConfig = {
  name: string
  required: boolean
  description: string
  defaultValue?: string
  validator?: (value: string) => boolean
}

const ENV_CONFIGS: EnvVarConfig[] = [
  // Core auth and encryption
  { name: 'AUTH_SECRET', required: true, description: 'Session token signing key (32+ chars)', validator: (v) => v.length >= 32 },
  { name: 'TOKEN_ENC_KEY', required: true, description: 'Ring token encryption key (32 bytes base64url)', validator: (v) => Buffer.from(v, 'base64url').length === 32 },
  { name: 'APP_URL', required: true, description: 'Public URL of the app (for OAuth callbacks)' },

  // Ring Partner API
  { name: 'RING_HMAC_KEY', required: true, description: 'HMAC signing key for Ring webhooks' },
  { name: 'RING_CLIENT_ID', required: true, description: 'Ring OAuth client ID' },
  { name: 'RING_CLIENT_SECRET', required: true, description: 'Ring OAuth client secret' },
  { name: 'NEXT_PUBLIC_RING_CLIENT_ID', required: true, description: 'Ring OAuth client ID (public)' },
  { name: 'NEXT_PUBLIC_APP_URL', required: true, description: 'Public URL (public)' },

  // Sensor HMAC (door / lock / tamper sensors)
  { name: 'SENSOR_HMAC_KEY', required: false, description: 'HMAC signing key for sensor webhook (required when sensor hardware is deployed)' },

  // Database
  { name: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string' },

  // SMS/Twilio
  { name: 'TWILIO_ACCOUNT_SID', required: true, description: 'Twilio account SID' },
  { name: 'TWILIO_AUTH_TOKEN', required: true, description: 'Twilio auth token' },
  { name: 'TWILIO_FROM', required: true, description: 'Twilio phone number' },

  // Web Push
  { name: 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', required: true, description: 'VAPID public key' },
  { name: 'VAPID_PRIVATE_KEY', required: true, description: 'VAPID private key' },
  { name: 'VAPID_SUBJECT', required: true, description: 'VAPID subject (mailto:)' },

  // Google Calendar
  { name: 'GOOGLE_CLIENT_ID', required: false, description: 'Google OAuth client ID for Calendar' },
  { name: 'GOOGLE_CLIENT_SECRET', required: false, description: 'Google OAuth client secret for Calendar' },

  // AI Agents (Gemini)
  { name: 'GEMINI_API_KEY', required: false, description: 'Gemini API key for AI features (or use GEMINI_API_KEYS for rotation)' },
  { name: 'GEMINI_API_KEYS', required: false, description: 'Comma-separated Gemini API keys for rotation' },
  { name: 'GEMINI_MODEL_WORKHORSE', required: false, defaultValue: 'gemini-3.1-flash-lite', description: 'Gemini workhorse model ID' },
  { name: 'GEMINI_MODEL_QUALITY', required: false, defaultValue: 'gemini-3.8-flash', description: 'Gemini quality model ID' },
  { name: 'GEMINI_MODEL_FALLBACK', required: false, defaultValue: 'gemma-4-26b', description: 'Gemini fallback model ID' },
  { name: 'GEMINI_MODEL_EMBEDDING', required: false, defaultValue: 'gemini-embedding-2', description: 'Gemini embedding model ID' },
  { name: 'GEMINI_MODEL_TTS', required: false, defaultValue: 'gemini-3.1-flash-tts', description: 'Gemini TTS model ID' },

  // Rate limits
  { name: 'GEMINI_LIMIT_WORKHORSE_RPM', required: false, defaultValue: '15', description: 'Workhorse requests per minute', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },
  { name: 'GEMINI_LIMIT_WORKHORSE_RPD', required: false, defaultValue: '500', description: 'Workhorse requests per day', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },
  { name: 'GEMINI_LIMIT_QUALITY_RPM', required: false, defaultValue: '5', description: 'Quality requests per minute', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },
  { name: 'GEMINI_LIMIT_QUALITY_RPD', required: false, defaultValue: '20', description: 'Quality requests per day', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },
  { name: 'GEMINI_LIMIT_FALLBACK_RPM', required: false, defaultValue: '30', description: 'Fallback requests per minute', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },
  { name: 'GEMINI_LIMIT_FALLBACK_RPD', required: false, defaultValue: '14400', description: 'Fallback requests per day', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },
  { name: 'GEMINI_LIMIT_EMBEDDING_RPM', required: false, defaultValue: '100', description: 'Embedding requests per minute', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },
  { name: 'GEMINI_LIMIT_EMBEDDING_RPD', required: false, defaultValue: '1000', description: 'Embedding requests per day', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },
  { name: 'GEMINI_LIMIT_TTS_RPM', required: false, defaultValue: '3', description: 'TTS requests per minute', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },
  { name: 'GEMINI_LIMIT_TTS_RPD', required: false, defaultValue: '10', description: 'TTS requests per day', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },

  // AI optional features
  { name: 'AI_DISABLED', required: false, defaultValue: '0', description: 'Disable all AI features (0 or 1)' },
  { name: 'AI_TIMEOUT_MS', required: false, defaultValue: '20000', description: 'AI request timeout in milliseconds', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },
  { name: 'AI_TTS', required: false, defaultValue: '0', description: 'Enable TTS audio caching (0 or 1)' },
  { name: 'AI_EMBED_RISK', required: false, defaultValue: '0', description: 'Enable semantic scam detection (0 or 1)' },
  { name: 'AI_EMBED_RISK_THRESHOLD', required: false, defaultValue: '0.82', description: 'Scam detection similarity threshold', validator: (v) => !isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 1 },
  { name: 'RISK_SHADOW', required: false, defaultValue: '0', description: 'Shadow mode: score is stored but controller/alerts are suppressed (0 or 1). P16 pilot.' },
  { name: 'RING_TALKBACK_ENABLED', required: false, defaultValue: '0', description: 'Enable Ring device talkback (0 or 1)' },
  { name: 'ESCALATION_SWEEP_MS', required: false, defaultValue: '5000', description: 'Escalation timer sweep interval (ms)', validator: (v) => !isNaN(Number(v)) && Number(v) > 0 },
  { name: 'CRON_SECRET', required: false, description: 'Secret for digest cron job protection' },
]

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateEnv(): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const config of ENV_CONFIGS) {
    const value = process.env[config.name]

    if (!value) {
      if (config.required) {
        errors.push(`Missing required environment variable: ${config.name} (${config.description})`)
      } else if (config.defaultValue !== undefined) {
        // Set default value
        process.env[config.name] = config.defaultValue
        warnings.push(`Using default value for ${config.name}: ${config.defaultValue}`)
      }
      continue
    }

    // Run validator if provided
    if (config.validator && !config.validator(value)) {
      if (config.required) {
        errors.push(`Invalid value for ${config.name}: ${config.description}`)
      } else {
        warnings.push(`Invalid value for ${config.name}: ${config.description}. Using: ${value}`)
      }
    }
  }

  // AI-specific warnings
  if (!process.env.GEMINI_API_KEY) {
    warnings.push('GEMINI_API_KEY not set - AI features will be disabled')
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    warnings.push('Google Calendar credentials not set - Calendar integration will be unavailable')
  }

  if (!process.env.REDIS_URL) {
    warnings.push('REDIS_URL not set - Rate limiting and caching will use in-memory fallback (not suitable for production)')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

export function validateEnvOrThrow(): void {
  const result = validateEnv()

  if (result.warnings.length > 0) {
    console.warn('[ENV VALIDATION] Warnings:')
    result.warnings.forEach(w => console.warn(`  - ${w}`))
  }

  if (!result.valid) {
    console.error('[ENV VALIDATION] Errors:')
    result.errors.forEach(e => console.error(`  - ${e}`))
    throw new Error('Environment validation failed. Please check your configuration.')
  }

  console.log('[ENV VALIDATION] All required environment variables are valid.')
}
