import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const maxDuration=60;
function esc(value:unknown){return String(value??"").replace(/[&<>'"]/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[character]!)}

export async function GET(req:NextRequest){
  if(!process.env.CRON_SECRET||req.headers.get("authorization")!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:"Unauthorized"},{status:401});
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceKey)return NextResponse.json({error:"SUPABASE_SERVICE_ROLE_KEY is not configured."},{status:500});
  const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const now=Date.now(),windowStart=new Date(now+18*60*60*1000).toISOString(),windowEnd=new Date(now+42*60*60*1000).toISOString();
  const {data:rows,error}=await supabase.from("assignments").select("id,status,response_token,officials(first_name,last_name,email),sport_positions(name),games!inner(game_number,status,starts_at,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name))").not("published_at","is",null).is("reminder_sent_at",null).neq("status","declined").neq("status","cancelled").gte("games.starts_at",windowStart).lt("games.starts_at",windowEnd).in("games.status",["active","open"]);
  if(error)return NextResponse.json({error:error.message},{status:500});
  const apiKey=process.env.RESEND_API_KEY;if(!apiKey)return NextResponse.json({error:"RESEND_API_KEY is not configured."},{status:500});
  let sent=0;const failures:string[]=[];
  for(const raw of rows||[]){
    const assignment=raw as any;
    const official=Array.isArray(assignment.officials)?assignment.officials[0]:assignment.officials;
    const game=Array.isArray(assignment.games)?assignment.games[0]:assignment.games;
    const position=Array.isArray(assignment.sport_positions)?assignment.sport_positions[0]:assignment.sport_positions;
    if(!official?.email){failures.push(`${official?.first_name||"Official"}: missing email`);continue}
    const home=(Array.isArray(game.home)?game.home[0]:game.home)?.name||"TBD";
    const away=(Array.isArray(game.away)?game.away[0]:game.away)?.name||"TBD";
    const location=(Array.isArray(game.location)?game.location[0]:game.location)?.name||"TBD";
    const when=new Date(game.starts_at).toLocaleString("en-US",{timeZone:"America/Chicago",weekday:"long",month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});
    const link=assignment.response_token?`${req.nextUrl.origin}/assignment/${assignment.response_token}`:req.nextUrl.origin;
    const html=`<div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:28px"><div style="max-width:620px;margin:auto;background:white;border:1px solid #e2e8f0;border-radius:14px;padding:28px"><h2 style="color:#172033">Game Assignment Reminder</h2><p>Hi ${esc(official.first_name)},</p><p>This is your automatic reminder for the following assignment.</p><h3>${esc(home)} vs ${esc(away)}</h3><p><b>${esc(when)}</b><br>${esc(location)}<br>${esc(position?.name||"Official")} • Game #${esc(game.game_number)}</p><p><a href="${link}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">View Assignment</a></p></div></div>`;
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":`automatic-reminder-${assignment.id}-${game.starts_at}`},body:JSON.stringify({from:"RefAssign <notifications@assignments.ref-assign.com>",to:[official.email],reply_to:"assignments@ref-assign.com",subject:`Game Tomorrow: ${home} vs ${away}`,html})});
    if(response.ok){
      sent++;
      await supabase.from("assignments").update({reminder_sent_at:new Date().toISOString()}).eq("id",assignment.id);
    }else{
      const result=await response.json().catch(()=>({})) as {message?:string};
      failures.push(`${official.first_name} ${official.last_name}: ${result.message||`email failed (${response.status})`}`);
    }
  }
  return NextResponse.json({checked:(rows||[]).length,sent,failed:failures.length,failures});
}
