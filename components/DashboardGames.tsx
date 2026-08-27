'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../lib/supabase/client'

type Game = {
  id: string
  starts_at: string
  officials_needed: number
  home: { name: string } | null
  away: { name: string } | null
  location: { name: string } | null
  leagues: { name: string } | null
  level: string | null
}

type Assignment = {
  game_id: string
  status: string
  published_at: string | null
}

type Category = 'Published' | 'Partially Accepted' | 'Not Published' | 'Not Assigned'

const categories: Category[] = ['Published','Partially Accepted','Not Published','Not Assigned']

export default function DashboardGames() {
  const supabase = useMemo(() => createClient(), [])
  const [games, setGames] = useState<Game[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [filter, setFilter] = useState<Category>('Not Assigned')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      const [g, a] = await Promise.all([
        supabase.from('games').select('id,starts_at,officials_needed,level,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name),leagues(name)').order('starts_at'),
        supabase.from('assignments').select('game_id,status,published_at')
      ])
      if (g.error || a.error) setError((g.error || a.error)!.message)
      else {
        setGames((g.data || []) as unknown as Game[])
        setAssignments((a.data || []) as Assignment[])
      }
      setLoading(false)
    }
    void load()
  }, [supabase])

  function categoryFor(game: Game): Category {
    const rows = assignments.filter(a => a.game_id === game.id)
    const assignedCount = rows.length
    const acceptedCount = rows.filter(a => a.status === 'accepted' || a.status === 'confirmed').length
    const unpublishedCount = rows.filter(a => !a.published_at).length

    if (assignedCount === 0) return 'Not Assigned'
    if (unpublishedCount > 0 || assignedCount < game.officials_needed) return 'Not Published'
    if (acceptedCount > 0 && acceptedCount < game.officials_needed) return 'Partially Accepted'
    return 'Published'
  }

  const counts = Object.fromEntries(categories.map(c => [c, games.filter(g => categoryFor(g) === c).length])) as Record<Category, number>
  const visible = games.filter(g => categoryFor(g) === filter)

  return <section className="card">
    <div className="cardHead"><div><h2>Game Assignment Status</h2><p>Track publishing and acceptance progress across scheduled games.</p></div></div>
    <div className="headerActions" style={{flexWrap:'wrap',marginBottom:16}}>{categories.map(c => <button key={c} className={filter===c?'primary':'secondary'} onClick={() => setFilter(c)}>{c} ({counts[c]})</button>)}</div>
    {error && <div className="errorBox">{error}</div>}
    {loading ? <p>Loading dashboard…</p> : <div className="tableWrap"><table><thead><tr><th>Date / Time</th><th>Game</th><th>League / Level</th><th>Location</th><th>Assigned</th><th>Accepted</th><th>Status</th></tr></thead><tbody>{visible.length ? visible.map(game => {
      const rows = assignments.filter(a => a.game_id === game.id)
      const accepted = rows.filter(a => a.status === 'accepted' || a.status === 'confirmed').length
      const category = categoryFor(game)
      const badge = category === 'Published' ? 'green' : category === 'Partially Accepted' ? 'amber' : category === 'Not Published' ? 'blue' : 'red'
      return <tr key={game.id}><td>{new Date(game.starts_at).toLocaleDateString()}<small>{new Date(game.starts_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></td><td><b>{game.home?.name || 'TBD'} vs {game.away?.name || 'TBD'}</b></td><td>{game.leagues?.name || '—'}<small>{game.level || ''}</small></td><td>{game.location?.name || 'TBD'}</td><td>{rows.length}/{game.officials_needed}</td><td>{accepted}/{game.officials_needed}</td><td><span className={`badge ${badge}`}>{category}</span></td></tr>
    }) : <tr><td colSpan={7}>No games in this status.</td></tr>}</tbody></table></div>}
  </section>
}
