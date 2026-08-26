import './globals.css'

export const metadata = {
  title: 'RefAssign | Sports Officials Scheduling',
  description: 'Multi-sport game and officials assignment management.'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}
