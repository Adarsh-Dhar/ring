export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false
  const from = process.env.RESEND_FROM ?? 'noreply@' + (process.env.DOMAIN ?? 'example.com')
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) { console.error('[EMAIL] Resend error', res.status, await res.text()); return false }
    return true
  } catch (e) { console.error('[EMAIL] failed', e); return false }
}
