import './globals.css'
import type { ReactNode } from 'react'

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="w-full py-4 bg-white shadow-sm">
          <div className="container mx-auto px-4">
            <h1 className="text-xl font-semibold">Simplex Viewer</h1>
          </div>
        </header>
        <main className="flex-1 container mx-auto px-4 py-6">
          {children}
        </main>
        <footer className="w-full py-4 bg-white border-t">
          <div className="container mx-auto px-4 text-sm text-gray-500">
            Built with Next.js and Plotly
          </div>
        </footer>
      </body>
    </html>
  )
}