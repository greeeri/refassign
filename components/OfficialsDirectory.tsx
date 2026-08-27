'use client'

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { createClient } from '../lib/supabase/client'
import OfficialsRosterManager from './OfficialsRosterManager'

type Official = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  home_area: string | null
  home_address: string | null
  home_city: string | null
  home_state: string | null
  home_zip: string | null
  sports: string[]
  certification_level: string | null
  active: boolean
}

type PositionRank = {
  official_id: string
  ref_rank: number
  ar1_rank: number
  ar2_rank: number
  fourth_rank: number
  mentor_rank: number
}

type Choice = { id: string; name: string }

type OfficialForm = {
  first_name: string
  last_name: string
  email: string
  phone: string
  home_area: string
  home_address: string
  home_city: string
  home_state: string
  home_zip: string
  sports: string[]
  certification_level: string
  ref_rank: string
  ar1_rank: string
  ar2_rank: string
  fourth_rank: string
  mentor_rank: string
  league_ids: string[]
  level_ids: string[]
}

const SPORTS = ['Soccer','Football','Basketball','Baseball','Softball','Volleyball','Wrestling','Track & Field','Other']

function newForm(): OfficialForm {
  return {
    first_name: '', last_name: '', email: '', phone: '', home_area: '',
    home_address: '', home_city: '', home_state: 'IA', home_zip: '',
    sports: ['Soccer'], certification_level: '', ref_rank: '1.0',
    ar1_rank: '1.0', ar2_rank: '1.0', fourth_rank: '1.0', mentor_rank: '1.0',
    league_ids: [], level_ids: []
  }
}

export default function OfficialsDirectory() {
  const supabase = useMemo(() => createClient(), [])
  const [officials, setOfficials] = useState<Official[]>([])
  const [positionRanks, setPositionRanks] = useState<Record<string, PositionRank>>({})
  const [leagues, setLeagues] = useState<Choice[]>([])
  const [levels, setLevels] = useState<Choice[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showRoster, setShowRoster] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sportFilter, setSportFilter] = useState('All')
  const [form, setForm] = useState<OfficialForm>(newForm())
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  async function load() {
    setLoading(true)
    setError('')
    const [o, lg, lv] = await Promise.all([
      supabase.from('officials').select('id,first_name,last_name,email,phone,home_area,home_address,home_city,home_state,home_zip,sports,certification_level,active').order('last_name').order('first_name'),
      supabase.from('leagues').select('id,name').eq('active', true).order('name'),
      supabase.from('levels').select('id,name').eq('active', true).order('name')
    ])
    if (o.error) { setError(o.error.message); setLoading(false); return }
    setOfficials((o.data || []) as Official[])
    setLeagues((lg.data || []) as Choice[])
    setLevels((lv.data || []) as Choice[])

    const { data: userData } = await supabase.auth.getUser()
    if (userData.user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
      const allowed = ['admin','assignor'].includes(profile?.role || '')
      setCanManage(allowed)
      if (allowed) {
        const { data: pr, error: rankError } = await supabase.from('official_soccer_position_rankings').select('official_id,ref_rank,ar1_rank,ar2_rank,fourth_rank,mentor_rank')
        if (rankError) setError(rankError.message)
        const map: Record<string, PositionRank> = {}
        for (const row of (pr || []) as PositionRank[]) {
          map[row.official_id] = {
            official_id: row.official_id,
            ref_rank: Number(row.ref_rank), ar1_rank: Number(row.ar1_rank),
            ar2_rank: Number(row.ar2_rank), fourth_rank: Number(row.fourth_rank),
            mentor_rank: Number(row.mentor_rank)
          }
        }
        setPositionRanks(map)
      }
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  function toggleSport(sport: string) {
    setForm(current => ({ ...current, sports: current.sports.includes(sport) ? current.sports.filter(x => x !== sport) : [...current.sports, sport] }))
  }

  function toggleChoice(field: 'league_ids' | 'level_ids', id: string) {
    setForm(current => ({ ...current, [field]: current[field].includes(id) ? current[field].filter(x => x !== id) : [...current[field], id] }))
  }

  function toggleAllChoices(field: 'league_ids' | 'level_ids', choices: Choice[]) {
    setForm(current => {
      const allIds = choices.map(choice => choice.id)
      const allSelected = allIds.length > 0 && allIds.every(id => current[field].includes(id))
      return { ...current, [field]: allSelected ? [] : allIds }
    })
  }

  function startAdd() {
    setEditingId(null)
    setForm(newForm())
    setShowForm(true)
    setError('')
  }

  async function startEdit(o: Official) {
    setEditingId(o.id)
    const [lg, lv] = await Promise.all([
      supabase.from('official_league_eligibility').select('league_id').eq('official_id', o.id),
      supabase.from('official_level_eligibility').select('level_id').eq('official_id', o.id)
    ])
    const pr = positionRanks[o.id]
    setForm({
      first_name: o.first_name, last_name: o.last_name, email: o.email || '', phone: o.phone || '',
      home_area: o.home_area || '', home_address: o.home_address || '', home_city: o.home_city || '',
      home_state: o.home_state || 'IA', home_zip: o.home_zip || '', sports: o.sports,
      certification_level: o.certification_level || '', ref_rank: (pr?.ref_rank ?? 1).toFixed(1),
      ar1_rank: (pr?.ar1_rank ?? 1).toFixed(1), ar2_rank: (pr?.ar2_rank ?? 1).toFixed(1),
      fourth_rank: (pr?.fourth_rank ?? 1).toFixed(1), mentor_rank: (pr?.mentor_rank ?? 1).toFixed(1),
      league_ids: (lg.data || []).map(x => x.league_id), level_ids: (lv.data || []).map(x => x.level_id)
    })
    setShowForm(true)
    setError('')
  }

  async function saveOfficial(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!form.sports.length) { setError('Select at least one sport.'); return }
    const rankValues = [form.ref_rank, form.ar1_rank, form.ar2_rank, form.fourth_rank, form.mentor_rank].map(v => Math.round(Number(v) * 10) / 10)
    if (rankValues.some(v => !Number.isFinite(v) || v < 1 || v > 10)) { setError('All position ranks must be between 1.0 and 10.0.'); return }

    setSaving(true)
    setError('')
    const payload = {
      first_name: form.first_name.trim(), last_name: form.last_name.trim(), email: form.email.trim() || null,
      phone: form.phone.trim() || null, home_area: form.home_area.trim() || null, home_address: form.home_address.trim() || null,
      home_city: form.home_city.trim() || null, home_state: form.home_state.trim() || null, home_zip: form.home_zip.trim() || null,
      sports: form.sports, certification_level: form.certification_level.trim() || null
    }

    let officialId = editingId
    if (officialId) {
      const result = await supabase.from('officials').update(payload).eq('id', officialId)
      if (result.error) { setSaving(false); setError(result.error.message); return }
    } else {
      const result = await supabase.from('officials').insert(payload).select('id').single()
      if (result.error) { setSaving(false); setError(result.error.message); return }
      officialId = result.data.id
    }

    if (canManage && officialId) {
      const [ref_rank, ar1_rank, ar2_rank, fourth_rank, mentor_rank] = rankValues
      const rankResult = await supabase.from('official_soccer_position_rankings').upsert({
        official_id: officialId, ref_rank, ar1_rank, ar2_rank, fourth_rank, mentor_rank, updated_at: new Date().toISOString()
      })
      if (rankResult.error) { setSaving(false); setError(rankResult.error.message); return }

      await Promise.all([
        supabase.from('official_league_eligibility').delete().eq('official_id', officialId),
        supabase.from('official_level_eligibility').delete().eq('official_id', officialId)
      ])
      if (form.league_ids.length) await supabase.from('official_league_eligibility').insert(form.league_ids.map(league_id => ({ official_id: officialId!, league_id })))
      if (form.level_ids.length) await supabase.from('official_level_eligibility').insert(form.level_ids.map(level_id => ({ official_id: officialId!, level_id })))
    }

    setSaving(false)
    setShowForm(false)
    setEditingId(null)
    setForm(newForm())
    await load()
  }

  async function toggleActive(o: Official) {
    const { error: updateError } = await supabase.from('officials').update({ active: !o.active }).eq('id', o.id)
    if (updateError) setError(updateError.message)
    else await load()
  }

  const visible = officials.filter(o => {
    const q = query.toLowerCase().trim()
    const matchesSearch = !q || `${o.first_name} ${o.last_name} ${o.email || ''} ${o.phone || ''}`.toLowerCase().includes(q)
    return matchesSearch && (sportFilter === 'All' || o.sports.includes(sportFilter))
  })

  function toggleSelected(id: string) {
    setSelectedIds(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id])
  }

  function toggleAllVisible() {
    const ids = visible.filter(o => !!o.email).map(o => o.id)
    const allSelected = ids.length > 0 && ids.every(id => selectedIds.includes(id))
    setSelectedIds(current => allSelected ? current.filter(id => !ids.includes(id)) : Array.from(new Set([...current, ...ids])))
  }

  function emailSelected() {
    const emails = officials.filter(o => selectedIds.includes(o.id) && o.email).map(o => o.email as string)
    if (!emails.length) { setError('Select at least one official with an email address.'); return }
    window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(','))}`
  }

  function rankInput(key: 'ref_rank'|'ar1_rank'|'ar2_rank'|'fourth_rank'|'mentor_rank', label: string) {
    return <label>{label}<input type="number" min="1" max="10" step="0.1" required value={form[key]} onChange={e => setForm(current => ({ ...current, [key]: e.target.value }))}/></label>
  }

  const allLeaguesSelected = leagues.length > 0 && leagues.every(x => form.league_ids.includes(x.id))
  const allLevelsSelected = levels.length > 0 && levels.every(x => form.level_ids.includes(x.id))

  return <>
    {canManage && <div className="actionbar"><div><h2>Officials</h2><p>Add individually or manage the entire roster with CSV.</p></div><button className="secondary" onClick={() => { setShowRoster(!showRoster); setShowForm(false) }}>{showRoster ? 'Close Roster Manager' : 'Roster Import / Export'}</button></div>}
    {showRoster && <OfficialsRosterManager/>}
    <section className="card">
      <div className="cardHead"><div><h2>Officials Directory</h2><p>{officials.length} officials</p></div><div className="headerActions">{canManage && <button className="secondary" disabled={!selectedIds.length} onClick={emailSelected}>Email Selected{selectedIds.length ? ` (${selectedIds.length})` : ''}</button>}<button className="primary" onClick={showForm ? () => setShowForm(false) : startAdd}>{showForm ? 'Cancel' : '+ Add Official'}</button></div></div>
      <div className="toolbar"><input placeholder="Search officials…" value={query} onChange={e => setQuery(e.target.value)}/><select value={sportFilter} onChange={e => setSportFilter(e.target.value)}><option>All</option>{SPORTS.map(s => <option key={s}>{s}</option>)}</select></div>
      {showForm && <form className="officialForm" onSubmit={saveOfficial}>
        <label>First name<input required value={form.first_name} onChange={e => setForm(current => ({...current, first_name:e.target.value}))}/></label>
        <label>Last name<input required value={form.last_name} onChange={e => setForm(current => ({...current, last_name:e.target.value}))}/></label>
        <label>Email<input type="email" value={form.email} onChange={e => setForm(current => ({...current, email:e.target.value}))}/></label>
        <label>Phone<input value={form.phone} onChange={e => setForm(current => ({...current, phone:e.target.value}))}/></label>
        <label>Home Address<input value={form.home_address} onChange={e => setForm(current => ({...current, home_address:e.target.value}))}/></label>
        <label>Home City<input value={form.home_city} onChange={e => setForm(current => ({...current, home_city:e.target.value}))}/></label>
        <label>Home State<input value={form.home_state} onChange={e => setForm(current => ({...current, home_state:e.target.value}))}/></label>
        <label>Home ZIP<input value={form.home_zip} onChange={e => setForm(current => ({...current, home_zip:e.target.value}))}/></label>
        <label>Certification<input value={form.certification_level} onChange={e => setForm(current => ({...current, certification_level:e.target.value}))}/></label>
        <fieldset><legend>Sports</legend><div className="sportChecks">{SPORTS.map(s => <label key={s}><input type="checkbox" checked={form.sports.includes(s)} onChange={() => toggleSport(s)}/>{s}</label>)}</div></fieldset>
        {canManage && <>{rankInput('ref_rank','REF Rank')}{rankInput('ar1_rank','AR1 Rank')}{rankInput('ar2_rank','AR2 Rank')}{rankInput('fourth_rank','4th Rank')}{rankInput('mentor_rank','Mentor Rank')}<fieldset><legend>Eligible Leagues</legend><div className="sportChecks"><label><input type="checkbox" checked={allLeaguesSelected} onChange={() => toggleAllChoices('league_ids', leagues)}/><b>{allLeaguesSelected ? 'Clear All Leagues' : 'Select All Leagues'}</b></label>{leagues.map(x => <label key={x.id}><input type="checkbox" checked={form.league_ids.includes(x.id)} onChange={() => toggleChoice('league_ids',x.id)}/>{x.name}</label>)}</div></fieldset><fieldset><legend>Eligible Levels</legend><div className="sportChecks"><label><input type="checkbox" checked={allLevelsSelected} onChange={() => toggleAllChoices('level_ids', levels)}/><b>{allLevelsSelected ? 'Clear All Levels' : 'Select All Levels'}</b></label>{levels.map(x => <label key={x.id}><input type="checkbox" checked={form.level_ids.includes(x.id)} onChange={() => toggleChoice('level_ids',x.id)}/>{x.name}</label>)}</div></fieldset></>}
        <div className="formActions"><button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Official'}</button></div>
      </form>}
      {error && <div className="errorBox">{error}</div>}
      {loading ? <p>Loading officials…</p> : <div className="tableWrap"><table><thead><tr>{canManage && <th><input type="checkbox" aria-label="Select visible officials" checked={visible.filter(o => o.email).length > 0 && visible.filter(o => o.email).every(o => selectedIds.includes(o.id))} onChange={toggleAllVisible}/></th>}<th>Official</th><th>Sports</th><th>Home</th>{canManage && <><th>Ref</th><th>AR1</th><th>AR2</th><th>4th</th><th>Mentor</th></>}<th>Status</th><th></th></tr></thead><tbody>{visible.map(o => { const pr = positionRanks[o.id]; return <tr key={o.id}>{canManage && <td><input type="checkbox" aria-label={`Select ${o.first_name} ${o.last_name}`} checked={selectedIds.includes(o.id)} disabled={!o.email} onChange={() => toggleSelected(o.id)}/></td>}<td><b>{o.first_name} {o.last_name}</b><small>{o.email || 'No email'}</small><small>{o.phone || 'No phone'}</small></td><td>{o.sports.join(', ')}</td><td>{[o.home_city,o.home_state].filter(Boolean).join(', ') || o.home_area || '—'}</td>{canManage && <><td><b>{(pr?.ref_rank ?? 1).toFixed(1)}</b></td><td><b>{(pr?.ar1_rank ?? 1).toFixed(1)}</b></td><td><b>{(pr?.ar2_rank ?? 1).toFixed(1)}</b></td><td><b>{(pr?.fourth_rank ?? 1).toFixed(1)}</b></td><td><b>{(pr?.mentor_rank ?? 1).toFixed(1)}</b></td></>}<td><span className={o.active ? 'badge green' : 'badge red'}>{o.active ? 'Active' : 'Inactive'}</span></td><td><button className="tableButton" onClick={() => void startEdit(o)}>Edit</button> <button className="tableButton" onClick={() => void toggleActive(o)}>{o.active ? 'Deactivate' : 'Activate'}</button></td></tr> })}</tbody></table></div>}
    </section>
  </>
}
