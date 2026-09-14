import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "../../../../../lib/supabase/admin";
import { releasePayrollBatch } from "../../../../../lib/stripe/payroll";
import { stripeConnectRequest } from "../../../../../lib/stripe/connect";

function validSignature(payload:string,header:string,secret:string){const values=header.split(",").reduce<Record<string,string[]>>((all,part)=>{const i=part.indexOf("=");if(i>0)(all[part.slice(0,i)]||=[]).push(part.slice(i+1));return all},{}),timestamp=values.t?.[0];if(!timestamp||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;const expected=createHmac("sha256",secret).update(`${timestamp}.${payload}`).digest("hex");return(values.v1||[]).some(signature=>{try{return timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(signature,"hex"))}catch{return false}})}
const objectId=(value:unknown)=>typeof value==="string"?value:value&&typeof value==="object"&&"id" in value?String((value as{id?:unknown}).id||""):"";

export async function POST(request:Request){
 const secret=process.env.STRIPE_PAYROLL_TEST_WEBHOOK_SECRET,key=process.env.STRIPE_CONNECT_TEST_SECRET_KEY;
 if(!secret||!key)return NextResponse.json({error:"Payroll webhook is not configured."},{status:503});
 const payload=await request.text(),signature=request.headers.get("stripe-signature")||"";if(!validSignature(payload,signature,secret))return NextResponse.json({error:"Invalid Stripe signature."},{status:400});
 let event:{id?:string;type?:string;data?:{object?:Record<string,any>}};try{event=JSON.parse(payload)}catch{return NextResponse.json({error:"Invalid payload."},{status:400})}if(!event.id||!event.type)return NextResponse.json({error:"Stripe event ID and type are required."},{status:400});
 const service=createServiceClient(),now=new Date().toISOString(),object=event.data?.object||{},batchId=String(object.metadata?.refassign_payroll_batch_id||object.client_reference_id||"");
 const{data:existing}=await service.from("stripe_webhook_events").select("processing_status,attempts").eq("event_id",event.id).maybeSingle();if(existing?.processing_status==="completed")return NextResponse.json({received:true,duplicate:true});
 const record={event_id:event.id,event_type:event.type,processing_status:"processing",attempts:Number(existing?.attempts||0)+1,last_error:null,updated_at:now};const recorded=existing?await service.from("stripe_webhook_events").update(record).eq("event_id",event.id):await service.from("stripe_webhook_events").insert(record);if(recorded.error)return NextResponse.json({error:recorded.error.message},{status:500});
 try{
  if(batchId&&["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(event.type)&&object.payment_status==="paid"){
   const{data:batch,error}=await service.from("payroll_batches").select("id,organization_id,league_id,total_funding_cents").eq("id",batchId).eq("stripe_checkout_session_id",object.id).single();if(error||!batch)throw new Error(error?.message||"Payroll batch was not found.");
   const paymentIntentId=objectId(object.payment_intent),paymentIntent=paymentIntentId?await stripeConnectRequest<{latest_charge?:string|{id?:string;balance_transaction?:{fee?:number}}}>(`payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge.balance_transaction`,key):null,chargeId=objectId(paymentIntent?.latest_charge),actualFee=typeof paymentIntent?.latest_charge==="object"?paymentIntent.latest_charge.balance_transaction?.fee:null;
   await Promise.all([service.from("payroll_batches").update({status:"settled",stripe_payment_intent_id:paymentIntentId||null,stripe_charge_id:chargeId||null,stripe_processing_cost_actual_cents:actualFee??null,funded_at:now,settled_at:now,funding_failure_message:null,updated_at:now}).eq("id",batch.id).eq("status","funding"),service.from("payment_transactions").update({status:"succeeded",stripe_object_type:"payment_intent",stripe_object_id:paymentIntentId||object.id,occurred_at:now}).eq("related_record_id",batch.id).eq("direction","credit"),service.from("payment_audit_events").insert({organization_id:batch.organization_id,league_id:batch.league_id,payroll_batch_id:batch.id,entity_type:"payroll_batch",entity_id:batch.id,event_type:"payroll_funding_settled",new_values:{status:"settled"},metadata:{stripe_event_id:event.id,stripe_payment_intent_id:paymentIntentId,stripe_charge_id:chargeId}})]);
   await releasePayrollBatch(service,batch.id,key);
  }else if(batchId&&["checkout.session.async_payment_failed","checkout.session.expired"].includes(event.type)){
   await service.from("payroll_batches").update({status:"funding_failed",funding_failure_message:event.type==="checkout.session.expired"?"Payroll checkout expired.":"Stripe could not collect the league funding.",updated_at:now}).eq("id",batchId).eq("status","funding");
   await service.from("payment_transactions").update({status:"failed",failure_message:event.type,occurred_at:now}).eq("related_record_id",batchId).eq("direction","credit");
  }
  await service.from("stripe_webhook_events").update({processing_status:"completed",processed_at:now,updated_at:now}).eq("event_id",event.id);return NextResponse.json({received:true});
 }catch(e){const message=e instanceof Error?e.message:"Payroll webhook failed.";await service.from("stripe_webhook_events").update({processing_status:"failed",last_error:message.slice(0,1000),updated_at:now}).eq("event_id",event.id);return NextResponse.json({error:message},{status:500})}
}
