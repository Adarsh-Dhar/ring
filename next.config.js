/** @type {import('next').NextConfig} */

// Hostnames of any dev tunnel you use (Pinggy, ngrok, Cloudflare Tunnel, ...).
// Next.js dev server blocks /_next/* requests from other origins unless they are listed here.
// Set TUNNEL_HOST in .env, e.g. TUNNEL_HOST=abcde-123-45-67-89.a.free.pinggy.link
const tunnelHosts = (process.env.TUNNEL_HOST || '')
  .split(',')
  .map((h) => h.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
  .filter(Boolean)

module.exports = {
  allowedDevOrigins: ['*.pinggy.link', '*.pinggy.io', '*.ngrok-free.app', '*.ngrok.app', '*.ngrok.io', '*.trycloudflare.com', '*.loca.lt', ...tunnelHosts],
  async headers() {
    return [
      {
        // The service worker must never be cached by a tunnel/proxy, and must be allowed to control "/"
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}