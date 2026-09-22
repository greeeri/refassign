import {NextRequest,NextResponse} from "next/server";
import {sendOfficialNotification} from "../../../../../lib/communications/officialCc";
import {requireManagedOrganization} from "../../../../../lib/server/organizationScope";
const esc=(v:unknown)=>String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]!);
export async function POST(request:NextRequest){
 const scope=await requireManagedOrganization(request);if(scope.error)return scope.error;const{service,user,organizationId}=scope;
 const body=await request.json().catch(()=>({})) as {officialIds?:string[];subject?:string;message?:string};
 const ids=[...new Set(body.officialIds||[])].slice(0,500),subject=body.subject?.trim().slice(0,180)||"",message=body.message?.trim().slice(0,10000)||"";
 if(!ids.length||!subject||!message)return NextResponse.json({error:"Choose at least one official and enter a subject and message."},{status:400});
 const key=process.env.RESEND_API_KEY;if(!key)return NextResponse.json({error:"Email is not configured yet."},{status:503});
 const{data:links,error}=await service.from("organization_officials").select("official_id,officials!inner(id,first_name,last_name,email)").eq("organization_id",organizationId).eq("active",true).in("official_id",ids);
 if(error)return NextResponse.json({error:error.message},{status:400});let sent=0;const failures:string[]=[];
 for(const row of links||[]){const o=(Array.isArray(row.officials)?row.officials[0]:row.officials) as {id:string;first_name:string;last_name:string;email:string|null}|null,name=`${o?.first_name||"Official"} ${o?.last_name||""}`.trim();if(!o?.email){failures.push(`${name}: missing email address`);continue}
  const{data:log,error:logError}=await service.from("official_communications").insert({organization_id:organizationId,official_id:o.id,channel:"email",message_type:"custom",recipient:o.email,subject,message_body:message,sent_by:user.id,delivery_status:"queued"}).select("id").single();if(logError||!log){failures.push(`${name}: ${logError?.message||"could not create communication log"}`);continue}
  const html=`<div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:28px"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px"><p>Hi ${esc(o.first_name)},</p><p>${esc(message).replace(/\n/g,"<br>")}</p></div></div>`;
  const response=await sendOfficialNotification(service,o.id,"https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","Idempotency-Key":`official-group-email-${log.id}`},body:JSON.stringify({from:"Ref Pro Group <notifications@assignments.ref-assign.com>",to:[o.email],reply_to:"assignments@ref-assign.com",subject,html}),signal:AbortSignal.timeout(10000)}),result=await response.json().catch(()=>({})) as{id?:string;message?:string};
  await service.from("official_communications").update(response.ok?{delivery_status:"sent",provider_message_id:result.id||null,sent_at:new Date().toISOString()}:{delivery_status:"failed",error_message:result.message||`Email provider returned ${response.status}`}).eq("id",log.id);if(response.ok)sent++;else failures.push(`${name}: ${result.message||"send failed"}`);
 }return NextResponse.json({sent,failed:failures.length,failures});
}
