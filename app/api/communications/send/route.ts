import {NextRequest,NextResponse} from "next/server";
import {createServerSupabaseClient} from "../../../../lib/supabase/server";

function esc(value:unknown){return String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]!)}
const labels={confirmation_request:"Confirmation Requested",schedule_change:"Schedule Change",cancellation:"Game Cancelled",reminder:"Game Reminder"} as const;

export async function POST(req:NextRequest){
  const supabase=await createServerSupabaseClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
  const {data:roles}=await supabase.rpc("current_user_roles");if(!((roles||[]) as string[]).some(role=>["admin","assignor"].includes(role)))return NextResponse.json({error:"Only Administrators and Assignors can send official communications."},{status:403});
  const body=await req.json().catch(()=>({})) as {assignmentIds?:string[];channel?:"email"|"text";messageType?:keyof typeof labels;note?:string};
  const ids=[...new Set(body.assignmentIds||[])].slice(0,100),channel=body.channel,messageType=body.messageType;
  if(!ids.length||!channel||!messageType||!labels[messageType])return NextResponse.json({error:"Assignments, channel, and message type are required."},{status:400});
  const {data:rows,error}=await supabase.from("assignments").select("id,game_id,official_id,status,response_token,officials(first_name,last_name,email,phone),sport_positions(name),games(game_number,starts_at,status,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name,address,city,state))").in("id",ids);
  if(error)return NextResponse.json({error:error.message},{status:400});
  let sent=0;const failures:string[]=[];
  for(const raw of rows||[]){
    const a=raw as any,o=Array.isArray(a.officials)?a.officials[0]:a.officials,g=Array.isArray(a.games)?a.games[0]:a.games,p=Array.isArray(a.sport_positions)?a.sport_positions[0]:a.sport_positions;
    const recipient=channel==="email"?o?.email:o?.phone,home=(Array.isArray(g?.home)?g.home[0]:g?.home)?.name||"TBD",away=(Array.isArray(g?.away)?g.away[0]:g?.away)?.name||"TBD",loc=Array.isArray(g?.location)?g.location[0]:g?.location;
    const when=new Date(g.starts_at).toLocaleString("en-US",{timeZone:"America/Chicago",weekday:"long",month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});
    const subject=`${labels[messageType]}: ${home} vs ${away}`,link=a.response_token?`${req.nextUrl.origin}/assignment/${a.response_token}`:req.nextUrl.origin;
    const note=body.note?.trim()||"";
    const {data:log,error:logError}=await supabase.from("official_communications").insert({assignment_id:a.id,game_id:a.game_id,official_id:a.official_id,channel,message_type:messageType,recipient:recipient||null,subject,sent_by:user.id,delivery_status:"queued"}).select("id").single();
    if(logError){failures.push(logError.message);continue}if(!recipient){const problem=`${o?.first_name||"Official"}: missing ${channel==="email"?"email":"mobile number"}`;failures.push(problem);await supabase.from("official_communications").update({delivery_status:"failed",error_message:problem}).eq("id",log.id);continue}
    const plain=`${labels[messageType]} — ${home} vs ${away}, ${when}, ${loc?.name||"TBD"}, ${p?.name||"Official"}.${note?` ${note}`:""} View: ${link}`;
    let ok=false,providerId:string|undefined,problem="";
    if(channel==="email"){
      const apiKey=process.env.RESEND_API_KEY;if(!apiKey)problem="RESEND_API_KEY is not configured.";else{const html=`<div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:28px"><div style="max-width:620px;margin:auto;background:white;border:1px solid #e2e8f0;border-radius:14px;padding:28px"><h2>${esc(labels[messageType])}</h2><p>Hi ${esc(o.first_name)},</p><h3>${esc(home)} vs ${esc(away)}</h3><p><b>${esc(when)}</b><br>${esc(loc?.name||"TBD")}<br>${esc(p?.name||"Official")} • Game #${esc(g.game_number)}</p>${note?`<p style="padding:12px;background:#f8fafc">${esc(note)}</p>`:""}<p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">View Assignment</a></p></div></div>`;const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":`communication-${log.id}`},body:JSON.stringify({from:"RefAssign <notifications@assignments.ref-assign.com>",to:[recipient],reply_to:"assignments@ref-assign.com",subject,html})});const result=await response.json().catch(()=>({})) as {id?:string;message?:string};ok=response.ok;providerId=result.id;problem=result.message||""}
    }else{
      const sid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN,from=process.env.TWILIO_PHONE_NUMBER;if(!sid||!token||!from)problem="Text messaging is not configured yet.";else{const form=new URLSearchParams({To:recipient,From:from,Body:plain,StatusCallback:`${req.nextUrl.origin}/api/webhooks/twilio`});const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:"POST",headers:{Authorization:`Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"},body:form});const result=await response.json().catch(()=>({})) as {sid?:string;message?:string};ok=response.ok;providerId=result.sid;problem=result.message||""}
    }
    await supabase.from("official_communications").update(ok?{delivery_status:"sent",provider_message_id:providerId||null,sent_at:new Date().toISOString()}:{delivery_status:"failed",error_message:problem||"Send failed"}).eq("id",log.id);
    if(ok)sent++;else failures.push(`${o.first_name} ${o.last_name}: ${problem||"send failed"}`);
  }
  return NextResponse.json({sent,failed:failures.length,failures});
}
