import {createHmac,timingSafeEqual} from "node:crypto";
import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export async function POST(req:NextRequest){
 const token=process.env.TWILIO_AUTH_TOKEN,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!token||!key)return NextResponse.json({error:"Webhook is not configured."},{status:503});
 const form=await req.formData(),params=[...form.entries()].map(([name,value])=>[name,String(value)] as const).sort(([a],[b])=>a.localeCompare(b)),signed=req.nextUrl.toString()+params.map(([name,value])=>`${name}${value}`).join(""),expected=createHmac("sha1",token).update(signed).digest(),provided=Buffer.from(req.headers.get("x-twilio-signature")||"","base64");
 if(provided.length!==expected.length||!timingSafeEqual(provided,expected))return NextResponse.json({error:"Invalid signature"},{status:401});
 const sid=String(form.get("MessageSid")||""),status=String(form.get("MessageStatus")||""),mapped=status==="delivered"?"delivered":["failed","undelivered"].includes(status)?"failed":"sent",supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,key,{auth:{persistSession:false,autoRefreshToken:false}});
 await supabase.from("official_communications").update({delivery_status:mapped,...(mapped==="delivered"?{delivered_at:new Date().toISOString()}:{})}).eq("provider_message_id",sid);
 return new NextResponse(null,{status:204});
}
