import './globals.css'

export const metadata = {
  title: 'Doorbell Helper',
  description: 'Simple doorbell alerts for the resident, decisions for the helper',
  manifest: '/manifest.webmanifest',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-900 text-slate-200">{children}</body>
    </html>
  )
}
