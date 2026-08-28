import {NextRequest,NextResponse} from 'next/server'
import {createServerSupabaseClient} from '../../../../lib/supabase/server'

function esc(v:unknown){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!))}

export async function POST(req:NextRequest){
  const supabase=await createServerSupabaseClient()
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle()
  if(!['admin','assignor'].includes(profile?.role||''))return NextResponse.json({error:'Only Administrators and Assignors can publish assignments.'},{status:403})
  const body=await req.json().catch(()=>({})) as {gameId?:string}
  if(!body.gameId)return NextResponse.json({error:'Game is required.'},{status:400})
  const {error:publishError}=await supabase.rpc('publish_game_assignments',{p_game_id:body.gameId})
  if(publishError)return NextResponse.json({error:publishError.message},{status:400})
  const {data:rows,error:loadError}=await supabase.from('assignments').select('id,status,published_at,accept_by,response_token,email_sent_at,officials(first_name,last_name,email),sport_positions(name),games(starts_at,notes,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name,address,city,state),leagues(name),levels(name))').eq('game_id',body.gameId).not('published_at','is',null).is('email_sent_at',null)
  if(loadError)return NextResponse.json({error:loadError.message},{status:400})
  const apiKey=process.env.RESEND_API_KEY
  if(!apiKey)return NextResponse.json({error:'RESEND_API_KEY is not configured.'},{status:500})
  let sent=0;const failures:string[]=[]
  for(const raw of rows||[]){
    const a=raw as any,o=Array.isArray(a.officials)?a.officials[0]:a.officials,g=Array.isArray(a.games)?a.games[0]:a.games,pos=Array.isArray(a.sport_positions)?a.sport_positions[0]:a.sport_positions
    if(!o?.email||!a.response_token){failures.push(`${o?.first_name||'Official'}: missing email or response link`);continue}
    const home=(Array.isArray(g?.home)?g.home[0]:g?.home)?.name||'TBD',away=(Array.isArray(g?.away)?g.away[0]:g?.away)?.name||'TBD',loc=Array.isArray(g?.location)?g.location[0]:g?.location,league=Array.isArray(g?.leagues)?g.leagues[0]:g?.leagues,level=Array.isArray(g?.levels)?g.levels[0]:g?.levels
    const responseUrl=`${req.nextUrl.origin}/assignment/${a.response_token}`
    const when=new Date(g.starts_at).toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})
    const deadline=a.accept_by?new Date(a.accept_by).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'within 24 hours'
    const address=[loc?.address,loc?.city,loc?.state].filter(Boolean).join(', ')
    const html=`<div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:28px"><div style="max-width:620px;margin:auto;background:white;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden"><div style="background:#14233b;color:white;padding:24px 28px"><div style="font-size:22px;font-weight:800">REF<span style="color:#60a5fa">ASSIGN</span></div><div style="font-size:12px;color:#cbd5e1;margin-top:4px">New Game Assignment</div></div><div style="padding:28px"><p style="font-size:16px;color:#172033">Hi ${esc(o.first_name)},</p><p style="color:#475569">You have a new game assignment from Ref Pro Group.</p><h2 style="color:#172033;margin:24px 0 18px">${esc(home)} vs ${esc(away)}</h2><table style="width:100%;border-collapse:collapse;color:#172033;font-size:14px"><tr><td style="padding:10px 0;color:#64748b">Date & Time</td><td style="padding:10px 0;font-weight:700">${esc(when)}</td></tr><tr><td style="padding:10px 0;color:#64748b">Position</td><td style="padding:10px 0;font-weight:700">${esc(pos?.name||'Official')}</td></tr><tr><td style="padding:10px 0;color:#64748b">Location</td><td style="padding:10px 0;font-weight:700">${esc(loc?.name||'TBD')}${address?`<br><span style="font-weight:400;color:#64748b">${esc(address)}</span>`:''}</td></tr><tr><td style="padding:10px 0;color:#64748b">League / Level</td><td style="padding:10px 0;font-weight:700">${esc(league?.name||'—')}${level?.name?` • ${esc(level.name)}`:''}</td></tr></table>${g?.notes?`<div style="margin-top:18px;padding:14px;background:#f8fafc;border-radius:8px"><b>Game Information</b><div style="margin-top:5px;color:#475569">${esc(g.notes)}</div></div>`:''}<div style="margin:22px 0;padding:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e"><b>Response required by ${esc(deadline)}</b></div><div style="text-align:center;margin:26px 0"><a href="${responseUrl}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:9px">View Assignment</a></div><p style="font-size:12px;color:#64748b">Use the secure link above to accept or decline your assignment. You do not need to sign in to respond.</p></div></div><div style="text-align:center;color:#94a3b8;font-size:10px;padding:18px">© 2026 Ref Pro Group, LLC. All rights reserved.</div></div>`
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`assignment-${a.id}-${a.published_at}`},body:JSON.stringify({from:'RefAssign <notifications@assignments.ref-assign.com>',to:[o.email],reply_to:'assignments@ref-assign.com',subject:`Game Assignment: ${home} vs ${away}`,html})})
    const result=await response.json().catch(()=>({})) as {id?:string;message?:string}
    if(response.ok){sent++;await supabase.from('assignments').update({email_sent_at:new Date().toISOString(),resend_email_id:result.id||null,email_error:null}).eq('id',a.id)}else{const msg=result.message||`Resend returned ${response.status}`;failures.push(`${o.first_name} ${o.last_name}: ${msg}`);await supabase.from('assignments').update({email_error:msg}).eq('id',a.id)}
  }
  return NextResponse.json({sent,failed:failures.length,failures})
}
