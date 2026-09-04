import './globals.css'
import './official-mobile.css'
import './assignor-mobile.css'

export const metadata = {
  title: 'RefAssign | Sports Officials Scheduling',
  description: 'Multi-sport game and officials assignment management.'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}<footer className="globalCopyright">© 2026 Ref Pro Group, LLC. All rights reserved.</footer></body></html>
}
