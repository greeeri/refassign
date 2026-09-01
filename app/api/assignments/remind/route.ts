import {NextRequest,NextResponse} from "next/server";
import {createServerSupabaseClient} from "../../../../lib/supabase/server";

function esc(value:unknown){return String(value??"").replace(/[&<>'"]/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[character]!)}

export async function POST(req:NextRequest){
  const supabase=await createServerSupabaseClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
  const {data:roles}=await supabase.rpc("current_user_roles");
  if(!((roles||[]) as string[]).some(role=>["admin","assignor"].includes(role)))return NextResponse.json({error:"Only Administrators and Assignors can send reminders."},{status:403});
  const body=await req.json().catch(()=>({})) as {gameIds?:string[]};
  const gameIds=[...new Set(body.gameIds||[])].slice(0,100);
  if(!gameIds.length)return NextResponse.json({error:"Select at least one game."},{status:400});
  const {data:rows,error}=await supabase.from("assignments").select("id,status,published_at,response_token,officials(first_name,last_name,email),sport_positions(name),games(game_number,starts_at,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name))").in("game_id",gameIds).not("published_at","is",null).neq("status","declined").neq("status","cancelled");
  if(error)return NextResponse.json({error:error.message},{status:400});
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey)return NextResponse.json({error:"RESEND_API_KEY is not configured."},{status:500});
  let sent=0;const failures:string[]=[];
  for(const raw of rows||[]){
    const assignment=raw as any,official=Array.isArray(assignment.officials)?assignment.officials[0]:assignment.officials,game=Array.isArray(assignment.games)?assignment.games[0]:assignment.games,position=Array.isArray(assignment.sport_positions)?assignment.sport_positions[0]:assignment.sport_positions;
    if(!official?.email){failures.push(`${official?.first_name||"Official"}: missing email`);continue}
    const home=(Array.isArray(game?.home)?game.home[0]:game?.home)?.name||"TBD",away=(Array.isArray(game?.away)?game.away[0]:game?.away)?.name||"TBD",location=(Array.isArray(game?.location)?game.location[0]:game?.location)?.name||"TBD";
    const when=new Date(game.starts_at).toLocaleString("en-US",{timeZone:"America/Chicago",weekday:"long",month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});
    const link=assignment.response_token?`${req.nextUrl.origin}/assignment/${assignment.response_token}`:req.nextUrl.origin;
    const html=`<div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:28px"><div style="max-width:620px;margin:auto;background:white;border:1px solid #e2e8f0;border-radius:14px;padding:28px"><h2 style="color:#172033">Game Assignment Reminder</h2><p>Hi ${esc(official.first_name)},</p><p>This is a reminder about your ${esc(position?.name||"official")} assignment.</p><h3>${esc(home)} vs ${esc(away)}</h3><p><b>${esc(when)}</b><br>${esc(location)}<br>Game #${esc(game.game_number)}</p><p><a href="${link}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">View Assignment</a></p></div></div>`;
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":`reminder-${assignment.id}-${Date.now()}`},body:JSON.stringify({from:"RefAssign <notifications@assignments.ref-assign.com>",to:[official.email],reply_to:"assignments@ref-assign.com",subject:`Reminder: ${home} vs ${away}`,html})});
    if(response.ok)sent++;else{const result=await response.json().catch(()=>({})) as {message?:string};failures.push(`${official.first_name} ${official.last_name}: ${result.message||`email failed (${response.status})`}`)}
  }
  return NextResponse.json({sent,failed:failures.length,failures});
}
