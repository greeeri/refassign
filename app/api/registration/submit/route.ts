import {NextRequest,NextResponse} from "next/server";
import {createServiceClient} from "../../../../lib/supabase/admin";

const emailOk=(value:string)=>/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
function ageOn(date:string){const dob=new Date(`${date}T00:00:00Z`),now=new Date();let age=now.getUTCFullYear()-dob.getUTCFullYear();if(now.getUTCMonth()<dob.getUTCMonth()||(now.getUTCMonth()===dob.getUTCMonth()&&now.getUTCDate()<dob.getUTCDate()))age--;return age;}

export async function POST(request:NextRequest){
 const body=await request.json().catch(()=>({})) as Record<string,string>;
 const first=(body.first_name||"").trim(),last=(body.last_name||"").trim(),dob=body.date_of_birth||"",programSlug=body.program||"iowa-soccer";
 if(!first||!last||first.length>80||last.length>80)return NextResponse.json({error:"First and last name are required."},{status:400});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dob)||Number.isNaN(new Date(`${dob}T00:00:00Z`).getTime())||new Date(`${dob}T00:00:00Z`)>new Date())return NextResponse.json({error:"Enter a valid date of birth."},{status:400});
 const age=ageOn(dob),under13=age<13;
 const parentName=(body.parent_name||"").trim(),parentEmail=(body.parent_email||"").trim().toLowerCase(),officialEmail=(body.email||"").trim().toLowerCase();
 if(under13&&(!parentName||!emailOk(parentEmail)))return NextResponse.json({error:"A parent or guardian name and valid email are required for officials under 13."},{status:400});
 if(!under13&&!emailOk(officialEmail))return NextResponse.json({error:"Enter a valid email address."},{status:400});
 const service=createServiceClient();
 const{data:program}=await service.from("registration_programs").select("id,name,registration_fee_cents").eq("slug",programSlug).eq("active",true).eq("registration_open",true).maybeSingle();
 if(!program)return NextResponse.json({error:"This registration page is not open."},{status:409});
 const email=under13?parentEmail:officialEmail;
 const{data:existing}=await service.from("official_registrations").select("id").eq("registration_program_id",program.id).eq("registration_year",new Date().getUTCFullYear()).ilike("email",email).maybeSingle();
 if(existing)return NextResponse.json({error:"A registration already exists for this email and program this year."},{status:409});
 const status=under13?"parent_consent_pending":"payment_pending";
 const{data:registration,error}=await service.from("official_registrations").insert({first_name:first,last_name:last,email,date_of_birth:dob,parent_name:under13?parentName:null,parent_email:under13?parentEmail:null,parent_consent_status:under13?"pending":"not_required",phone:under13?null:(body.phone||null),home_address:under13?null:(body.home_address||null),home_city:under13?null:(body.home_city||null),home_state:under13?null:(body.home_state||null),home_zip:under13?null:(body.home_zip||null),sport:"Soccer",fee_cents:program.registration_fee_cents,registration_program_id:program.id,status,payment_status:"pending"}).select("id,public_token").single();
 if(error||!registration)return NextResponse.json({error:error?.message||"Registration could not be submitted."},{status:400});
 if(!under13)return NextResponse.json({token:registration.public_token,requiresParentConsent:false});
 const{data:consent,error:consentError}=await service.from("parental_consents").insert({registration_id:registration.id,parent_name:parentName,parent_email:parentEmail,child_name:`${first} ${last}`}).select("consent_token").single();
 if(consentError||!consent)return NextResponse.json({error:"Registration was saved, but the parent consent request could not be created. Please contact Iowa Soccer."},{status:500});
 const consentUrl=`${request.nextUrl.origin}/parent-consent/${consent.consent_token}`;
 if(!process.env.RESEND_API_KEY)return NextResponse.json({error:"Registration was saved, but parent consent email is not configured. Please contact Iowa Soccer."},{status:503});
 const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":`parent-consent-${registration.id}`},body:JSON.stringify({from:"Iowa Soccer Registration <notifications@assignments.ref-assign.com>",to:[parentEmail],reply_to:"assignments@ref-assign.com",subject:`Parent consent required for ${first} ${last}`,html:`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><h2>Iowa Soccer Parent Consent Request</h2><p>${esc(parentName)},</p><p>${esc(first)} ${esc(last)} began an Iowa Soccer referee registration and provided your email so RefAssign can request your consent.</p><p>Before any additional personal information is collected or the registration can continue, please review and sign the consent form below.</p><p><a href="${consentUrl}" style="display:inline-block;background:#166534;color:white;padding:12px 18px;border-radius:7px;text-decoration:none;font-weight:bold">Review and Sign Parent Consent</a></p><p>The information is used to manage referee registration, eligibility, training, assignments, communication, and payment records. It is available only to authorized Iowa Soccer/RefAssign administrators and registrars except for limited assignment information needed to administer games. You may refuse consent or request review or deletion by replying to this email.</p><p>If consent is not provided within a reasonable time, the pending contact information will be removed.</p><p><a href="${request.nextUrl.origin}/privacy#children">Children’s Privacy Notice</a></p></div>`})});
 if(!response.ok)return NextResponse.json({error:"Registration was saved, but the parent consent email could not be delivered. Please contact Iowa Soccer."},{status:502});
 await service.from("parental_consents").update({sent_at:new Date().toISOString()}).eq("registration_id",registration.id);
 return NextResponse.json({token:registration.public_token,requiresParentConsent:true});
}
