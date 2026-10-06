/**
 * Safe redirect validation to prevent open redirects
 */

export function safeNext(nextParam: string | null): string {
  if (!nextParam) return ''
  // Must start with / (relative path)
  if (!nextParam.startsWith('/')) return ''
  // Must not start with // (protocol-relative)
  if (nextParam.startsWith('//')) return ''
  // Must not contain a scheme (http://, https://, etc.)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(nextParam)) return ''
  return nextParam
}

export function buildUrl(path: string, reqUrl: string): string {
  const appUrl = process.env.APP_URL
  if (appUrl) {
    return new URL(path, appUrl).toString()
  }
  const url = new URL(reqUrl)
  const proto = url.protocol
  const host = url.host
  return `${proto}//${host}${path}`
}
