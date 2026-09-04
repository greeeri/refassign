import './globals.css'
import './official-mobile.css'
import './assignor-mobile.css'
import './brand-concept2.css'
import IowaSoccerNavEnhancer from '../components/IowaSoccerNavEnhancer'

export const metadata = {
  title: 'Ref Pro Group | Better Officiating, Connected',
  description: 'Ref Pro Group makes officiating easier to access, more efficient to develop, and simpler to assign and administer through the RefAssign platform.'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}<IowaSoccerNavEnhancer/><footer className="globalCopyright">© 2026 Ref Pro Group, LLC. All rights reserved.</footer></body></html>
}
