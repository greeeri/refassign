import {createHmac,timingSafeEqual} from "node:crypto";
import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

function validSignature(payload:string,id:string,timestamp:string,signature:string,secret:string){
  if(Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const key=Buffer.from(secret.replace(/^whsec_/,""),"base64"),expected=createHmac("sha256",key).update(`${id}.${timestamp}.${payload}`).digest();
  return signature.split(" ").some(part=>{const encoded=part.startsWith("v1,")?part.slice(3):part;try{const supplied=Buffer.from(encoded,"base64");return supplied.length===expected.length&&timingSafeEqual(supplied,expected)}catch{return false}});
}
export async function POST(req:NextRequest){
  const secret=process.env.RESEND_WEBHOOK_SECRET,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!secret||!key)return NextResponse.json({error:"Webhook is not configured."},{status:503});
  const payload=await req.text(),id=req.headers.get("svix-id")||"",timestamp=req.headers.get("svix-timestamp")||"",signature=req.headers.get("svix-signature")||"";
  if(!id||!timestamp||!signature||!validSignature(payload,id,timestamp,signature,secret))return NextResponse.json({error:"Invalid signature"},{status:401});
  const event=JSON.parse(payload) as {type:string;created_at?:string;data?:{email_id?:string}};if(!event.data?.email_id)return NextResponse.json({received:true});
  const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,key,{auth:{persistSession:false,autoRefreshToken:false}}),at=event.created_at||new Date().toISOString();
  const values=event.type==="email.opened"?{delivery_status:"opened",opened_at:at,delivered_at:at}:event.type==="email.delivered"?{delivery_status:"delivered",delivered_at:at}:["email.bounced","email.failed","email.complained","email.suppressed"].includes(event.type)?{delivery_status:"failed",error_message:event.type}:null;
  if(values)await supabase.from("official_communications").update(values).eq("provider_message_id",event.data.email_id);
  return NextResponse.json({received:true});
}
