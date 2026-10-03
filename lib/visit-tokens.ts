import crypto from 'crypto'

export const newToken    = () => crypto.randomBytes(24).toString('base64url')
export const newDeviceId = () => crypto.randomBytes(16).toString('base64url')
export const newSecret   = () => crypto.randomBytes(32).toString('hex')
export const hashToken   = (t: string) => crypto.createHash('sha256').update(t).digest('hex')
