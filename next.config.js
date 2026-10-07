/** @type {import('next').NextConfig} */

// Hostnames of any dev tunnel you use (Pinggy, ngrok, Cloudflare Tunnel, ...).
// Next.js dev server blocks /_next/* requests from other origins unless they are listed here.
// Set TUNNEL_HOST in .env, e.g. TUNNEL_HOST=abcde-123-45-67-89.a.free.pinggy.link
const tunnelHosts = (process.env.TUNNEL_HOST || '')
  .split(',')
  .map((h) => h.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
  .filter(Boolean)

module.exports = {
  serverExternalPackages: ['@vladmandic/face-api', '@tensorflow/tfjs', '@tensorflow/tfjs-backend-wasm', '@napi-rs/canvas'],
  allowedDevOrigins: ['*.pinggy.net', '*.pinggy.link', '*.pinggy.io', '*.ngrok-free.app', '*.ngrok.app', '*.ngrok.io', '*.trycloudflare.com', '*.loca.lt', '192.168.0.102', ...tunnelHosts],
  typescript: {
    // Ignore type errors during build to prevent memory issues
    ignoreBuildErrors: false,
  },
  eslint: {
    // Disable ESLint during build to save memory
    ignoreDuringBuilds: false,
  },

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
      {
        // Security headers for all routes
        source: '/:path*',
        headers: [
          // Prevent clickjacking attacks
          { key: 'X-Frame-Options', value: 'DENY' },
          // Prevent MIME type sniffing
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Enable XSS protection
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          // Referrer policy
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Content Security Policy (basic - can be tightened based on actual needs)
          {
            key: 'Content-Security-Policy',
            value: process.env.NODE_ENV === 'production'
              ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.twilio.com https://api.resend.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';"
              : "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'self' http://localhost:* ws://localhost:*; img-src 'self' data: blob: http://localhost:*;"
          },
        ],
      },
    ]
  },
}