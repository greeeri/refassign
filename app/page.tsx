'use client'

import { useMemo, useState } from 'react'

type Game = { id:number; date:string; time:string; sport:string; level:string; home:string; away:string; location:string; needed:number; assigned:number }

const initialGames: Game[] = [
  {id:1,date:'Aug 28',time:'7:00 PM',sport:'Soccer',level:'Varsity',home:'Ankeny',away:'Johnston',location:'Ankeny Stadium',needed:3,assigned:0},
  {id:2,date:'Aug 29',time:'6:30 PM',sport:'Soccer',level:'Varsity',home:'Waukee',away:'Urbandale',location:'Waukee Stadium',needed:3,assigned:2},
  {id:3,date:'Aug 30',time:'7:00 PM',sport:'Football',level:'Varsity',home:'Southeast Polk',away:'Dowling',location:'SEP Stadium',needed:5,assigned:5},
  {id:4,date:'Sep 1',time:'6:00 PM',sport:'Volleyball',level:'JV',home:'Johnston',away:'Ankeny',location:'Johnston HS',needed:2,assigned:1}
]

const officials = [
  {name:'Jordan Miller', sports:'Soccer', area:'Des Moines', status:'Available'},
  {name:'Chris Taylor', sports:'Soccer, Football', area:'West Des Moines', status:'Available'},
  {name:'Sarah Lee', sports:'Soccer, Volleyball', area:'Johnston', status:'Limited'},
  {name:'Mike Anderson', sports:'Football', area:'Altoona', status:'Available'}
]

const nav = ['Dashboard','Games','Officials','Assignments','Calendar','Sports & Rules']

export default function Home(){
 const [section,setSection]=useState('Dashboard')
 const [games,setGames]=useState(initialGames)
 const [sport,setSport]=useState('All')
 const stats=useMemo(()=>({games:games.length,need:games.filter(g=>g.assigned===0).length,partial:games.filter(g=>g.assigned>0&&g.assigned<g.needed).length,full:games.filter(g=>g.assigned>=g.needed).length}),[games])
 const filtered=sport==='All'?games:games.filter(g=>g.sport===sport)
 const badge=(g:Game)=>g.assigned>=g.needed?<span className="badge green">Fully assigned</span>:g.assigned?<span className="badge amber">Partially assigned</span>:<span className="badge red">Needs officials</span>
 const autoAssign=()=>setGames(gs=>gs.map(g=>({...g,assigned:g.needed})))
 return <div className="shell"><aside><div className="brand">Ref<span>Assign</span></div><div className="tag">OFFICIALS MANAGEMENT</div><nav>{nav.map(n=><button key={n} className={section===n?'active':''} onClick={()=>setSection(n)}>{n}</button>)}</nav><div className="asideFoot">Built for soccer.<br/>Ready for every sport.</div></aside><main>
 <header><div><h1>{section}</h1><p>{section==='Dashboard'?'Multi-sport officials scheduling • Soccer-ready':'RefAssign scheduling workspace'}</p></div><div className="headerActions"><button className="secondary">Import Games</button><button className="primary">+ Add Game</button></div></header>
 {section==='Dashboard'&&<><div className="metrics"><Metric n={stats.games} t="Games this week"/><Metric n={stats.need} t="Need officials"/><Metric n={stats.partial} t="Partially assigned"/><Metric n={stats.full} t="Fully assigned"/><Metric n={0} t="Potential conflicts"/></div><div className="columns"><section className="card"><div className="cardHead"><h2>Upcoming Games</h2><button onClick={()=>setSection('Games')}>View all</button></div><GameTable games={games} badge={badge}/></section><section className="card"><h2>Open Positions</h2>{games.filter(g=>g.assigned<g.needed).map(g=><div className="open" key={g.id}><div><b>{g.home} vs {g.away}</b><small>{g.sport} • {g.date} • {g.needed-g.assigned} open</small></div><button onClick={()=>setSection('Assignments')}>Assign</button></div>)}</section></div></>}
 {section==='Games'&&<section className="card"><div className="toolbar"><h2>Game Schedule</h2><select value={sport} onChange={e=>setSport(e.target.value)}><option>All</option><option>Soccer</option><option>Football</option><option>Basketball</option><option>Baseball</option><option>Softball</option><option>Volleyball</option></select></div><GameTable games={filtered} badge={badge}/></section>}
 {section==='Officials'&&<section className="card"><div className="cardHead"><h2>Officials Directory</h2><button className="primary">+ Add Official</button></div><table><thead><tr><th>Official</th><th>Sports</th><th>Area</th><th>Availability</th></tr></thead><tbody>{officials.map(o=><tr key={o.name}><td><b>{o.name}</b></td><td>{o.sports}</td><td>{o.area}</td><td><span className={o.status==='Available'?'badge green':'badge amber'}>{o.status}</span></td></tr>)}</tbody></table></section>}
 {section==='Assignments'&&<><div className="actionbar"><div><h2>Assignment Center</h2><p>Fill required crew positions and optionally add a Mentor.</p></div><button className="success" onClick={autoAssign}>⚡ Auto Assign Open Games</button></div>{games.map(g=><section className="card assignment" key={g.id}><div><h3>{g.home} vs {g.away}</h3><p>{g.date} • {g.time} • {g.sport} • {g.location}</p>{g.sport==='Soccer'&&<small>Optional: 4th Official • Mentor</small>}</div><div className="fill"><b>{g.assigned}/{g.needed}</b><span>required positions filled</span></div>{badge(g)}</section>)}</>}
 {section==='Calendar'&&<section className="card"><h2>Calendar</h2><div className="calendar">{Array.from({length:28},(_,i)=><div className="day" key={i}><b>{i+1}</b>{i<games.length&&<span>{games[i].sport}<br/>{games[i].home}</span>}</div>)}</div></section>}
 {section==='Sports & Rules'&&<section className="card"><h2>Sport Assignment Rules</h2><Rule sport="Soccer" count="3 required" roles="Center Referee • AR1 • AR2 • optional 4th Official • optional Mentor"/><Rule sport="Football" count="5–7" roles="Referee • Umpire • Lines • Back/Field/Side Judges"/><Rule sport="Basketball" count="2–3" roles="Crew Chief • Referees"/><Rule sport="Baseball / Softball" count="2–4" roles="Plate Umpire • Base Umpires"/><Rule sport="Volleyball" count="2–4" roles="R1 • R2 • Line Judges"/></section>}
 </main></div>
}
function Metric({n,t}:{n:number,t:string}){return <div className="metric"><i></i><strong>{n}</strong><span>{t}</span></div>}
function GameTable({games,badge}:{games:Game[],badge:(g:Game)=>React.ReactNode}){return <div className="tableWrap"><table><thead><tr><th>Date</th><th>Game</th><th>Sport</th><th>Location</th><th>Officials</th><th>Status</th></tr></thead><tbody>{games.map(g=><tr key={g.id}><td>{g.date}<small>{g.time}</small></td><td><b>{g.home} vs {g.away}</b><small>{g.level}</small></td><td>{g.sport}</td><td>{g.location}</td><td>{g.assigned}/{g.needed}</td><td>{badge(g)}</td></tr>)}</tbody></table></div>}
function Rule({sport,count,roles}:{sport:string,count:string,roles:string}){return <div className="rule"><div><b>{sport}</b><small>{roles}</small></div><span className="badge blue">{count} officials</span></div>}
