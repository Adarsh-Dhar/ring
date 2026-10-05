import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import ThemeSelect from '@/components/theme-select'

export const metadata = {
  title: 'Ring Safe',
  description: 'Simple doorbell alerts for the resident, decisions for the helper',
  manifest: '/manifest.webmanifest',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground">
        <ThemeProvider>
          <div className="fixed bottom-4 right-4 z-50"><ThemeSelect /></div>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
