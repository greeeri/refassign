import {NextRequest,NextResponse} from 'next/server'
import {createServerSupabaseClient} from '../../../../lib/supabase/server'
import {createServiceClient} from '../../../../lib/supabase/admin'

function esc(v:unknown){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!))}

export async function POST(req:NextRequest){
  const supabase=await createServerSupabaseClient()
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const {data:roles}=await supabase.rpc('current_user_roles')
  if(!((roles||[]) as string[]).some(role=>['admin','assignor'].includes(role)))return NextResponse.json({error:'Only Administrators and Assignors can change game status.'},{status:403})
  const body=await req.json().catch(()=>({})) as {gameId?:string;status?:string}
  if(!body.gameId||!body.status)return NextResponse.json({error:'Game and status are required.'},{status:400})
  const {error:statusError}=await supabase.rpc('set_game_status',{p_game_id:body.gameId,p_status:body.status})
  if(statusError)return NextResponse.json({error:statusError.message},{status:400})
  if(!['canceled','rained_out'].includes(body.status))return NextResponse.json({updated:true,sent:0,failed:0,failures:[]})

  const service=createServiceClient()
  const {data:rows,error:loadError}=await service.from('assignments').select('id,cancellation_notified_at,officials(first_name,last_name,email),sport_positions(name),games(game_number,starts_at,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name,address,city,state),leagues(name),levels(name))').eq('game_id',body.gameId).eq('status','cancelled').is('cancellation_notified_at',null)
  if(loadError)return NextResponse.json({error:loadError.message},{status:400})
  const apiKey=process.env.RESEND_API_KEY
  if(!apiKey)return NextResponse.json({updated:true,sent:0,failed:(rows||[]).length,failures:['RESEND_API_KEY is not configured.']})
  let sent=0;const failures:string[]=[]
  for(const raw of rows||[]){
    const a=raw as any,o=Array.isArray(a.officials)?a.officials[0]:a.officials,g=Array.isArray(a.games)?a.games[0]:a.games,pos=Array.isArray(a.sport_positions)?a.sport_positions[0]:a.sport_positions
    if(!o?.email){const message=`${o?.first_name||'Official'}: missing email`;failures.push(message);await service.from('assignments').update({cancellation_email_error:message}).eq('id',a.id);continue}
    const home=(Array.isArray(g?.home)?g.home[0]:g?.home)?.name||'TBD',away=(Array.isArray(g?.away)?g.away[0]:g?.away)?.name||'TBD',loc=Array.isArray(g?.location)?g.location[0]:g?.location
    const when=new Date(g.starts_at).toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})
    const label=body.status==='rained_out'?'rained out':'cancelled',subject=`Game ${body.status==='rained_out'?'Rained Out':'Cancelled'}: ${home} vs ${away}`
    const html=`<div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:28px"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden"><div style="background:#14233b;color:#fff;padding:24px 28px"><div style="font-size:22px;font-weight:800">REF<span style="color:#60a5fa">ASSIGN</span></div><div style="font-size:12px;color:#cbd5e1;margin-top:4px">Game Status Change</div></div><div style="padding:28px"><p>Hi ${esc(o.first_name)},</p><h2 style="color:#b91c1c">This game has been ${esc(label)}.</h2><h3>${esc(home)} vs ${esc(away)}</h3><p><b>${esc(when)}</b><br>${esc(pos?.name||'Official')} • ${esc(loc?.name||'TBD')}<br>Game ${esc(g.game_number||'—')}</p><div style="margin-top:20px;padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">This assignment was removed from your active schedule. You are now available for other games at this time.</div></div></div></div>`
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`game-status-${a.id}-${body.status}`},body:JSON.stringify({from:'RefAssign <notifications@assignments.ref-assign.com>',to:[o.email],reply_to:'assignments@ref-assign.com',subject,html})})
    const result=await response.json().catch(()=>({})) as {id?:string;message?:string}
    if(response.ok){sent++;await service.from('assignments').update({cancellation_notified_at:new Date().toISOString(),cancellation_email_id:result.id||null,cancellation_email_error:null}).eq('id',a.id)}else{const message=result.message||`Email provider returned ${response.status}`;failures.push(`${o.first_name} ${o.last_name}: ${message}`);await service.from('assignments').update({cancellation_email_error:message}).eq('id',a.id)}
  }
  return NextResponse.json({updated:true,sent,failed:failures.length,failures})
}
