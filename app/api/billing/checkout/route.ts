import {NextRequest,NextResponse} from "next/server";
import {createServerSupabaseClient} from "../../../../lib/supabase/server";
import {createServiceClient} from "../../../../lib/supabase/admin";

const PRICES={starter:{id:"price_1UEVR3EeVYrhX6SUHxQBlJF0",limit:50,founding:false},pro:{id:"price_1UEVSJEeVYrhX6SUmTGqsUda",limit:100,founding:false},pro_founding:{id:"price_1UEVTSEeVYrhX6SUKDRHOwRm",limit:100,founding:true},premier:{id:"price_1UEVWiEeVYrhX6SU6lFSx8xZ",limit:250,founding:false}} as const;
const ADDITIONAL_OFFICIAL_BLOCK_PRICE="price_1UEVXQEeVYrhX6SUO84ya68o";
const TEXT_MESSAGING_PRICE="price_1UEVYHEeVYrhX6SUA5VuwPBG";

type Plan=keyof typeof PRICES;

export async function POST(request:NextRequest){
 const stripeKey=process.env.STRIPE_SECRET_KEY;
 if(!stripeKey)return NextResponse.json({error:"Stripe is not configured."},{status:503});
 const session=await createServerSupabaseClient();
 const{data:{user}}=await session.auth.getUser();
 if(!user)return NextResponse.json({error:"Please sign in before starting a subscription."},{status:401});
 const contentType=request.headers.get("content-type")||"";
 let body:{plan?:Plan;organization_name?:string;official_count?:number;texting_addon?:boolean;purchaser_state?:string;iowa_exemption_certified?:boolean}={};
 let exemptionCertificate:File|null=null;
 if(contentType.includes("multipart/form-data")){
  const formData=await request.formData();
  body={
   plan:String(formData.get("plan")||"") as Plan,
   organization_name:String(formData.get("organization_name")||""),
   official_count:Number(formData.get("official_count")||1),
   texting_addon:formData.get("texting_addon")==="true",
   purchaser_state:String(formData.get("purchaser_state")||""),
   iowa_exemption_certified:formData.get("iowa_exemption_certified")==="true"
  };
  const uploaded=formData.get("exemption_certificate");
  exemptionCertificate=uploaded instanceof File&&uploaded.size>0?uploaded:null;
 }else body=await request.json().catch(()=>({}));
 const plan=body.plan&&PRICES[body.plan]?body.plan:null;
 if(!plan)return NextResponse.json({error:"Choose a valid RefAssign plan."},{status:400});
 const organizationName=String(body.organization_name||"").trim().slice(0,160);
 if(!organizationName)return NextResponse.json({error:"Organization name is required."},{status:400});
 const officialCount=Math.max(1,Math.floor(Number(body.official_count)||1));
 if(officialCount>250)return NextResponse.json({error:"Organizations with more than 250 officials require an Enterprise plan. Contact Ref Pro Group to continue."},{status:400});
 const purchaserState=String(body.purchaser_state||"").trim().toUpperCase();
 if(!/^[A-Z]{2}$/.test(purchaserState))return NextResponse.json({error:"Select the organization’s state."},{status:400});
 if(purchaserState==="IA"){
  if(!body.iowa_exemption_certified)return NextResponse.json({error:"Confirm the Iowa commercial-use certification before continuing."},{status:400});
  if(!exemptionCertificate)return NextResponse.json({error:"Attach the completed Iowa sales-tax exemption certificate before continuing."},{status:400});
  if(exemptionCertificate.size>10*1024*1024)return NextResponse.json({error:"The exemption certificate must be 10 MB or smaller."},{status:400});
  if(!["application/pdf","image/jpeg","image/png"].includes(exemptionCertificate.type))return NextResponse.json({error:"Upload the exemption certificate as a PDF, JPG, or PNG file."},{status:400});
 }
 const service=createServiceClient();
 const price=PRICES[plan];
 const additionalBlocks=Math.max(0,Math.ceil((officialCount-price.limit)/25));
 const textingAddon=Boolean(body.texting_addon);
 const{data:pendingId,error:insertError}=await service.rpc("create_pending_organization_subscription",{p_user_id:user.id,p_organization_name:organizationName,p_plan:plan,p_official_limit:price.limit,p_stripe_price_id:price.id,p_founding_offer:price.founding});
 if(insertError||!pendingId)return NextResponse.json({error:insertError?.message||"Could not prepare subscription."},{status:500});
 const{data:pending}=await service.from("refassign_subscriptions").update({additional_official_blocks:additionalBlocks,updated_at:new Date().toISOString()}).eq("id",pendingId).select("organization_id").single();
 if(!pending?.organization_id)return NextResponse.json({error:"Could not prepare the organization’s billing record."},{status:500});
 if(purchaserState==="IA"&&exemptionCertificate){
  const safeName=exemptionCertificate.name.replace(/[^a-zA-Z0-9._-]/g,"-").slice(-120)||"exemption-certificate.pdf";
  const storagePath=`${pending.organization_id}/${pendingId}/${Date.now()}-${safeName}`;
  const{error:uploadError}=await service.storage.from("tax-exemption-certificates").upload(storagePath,await exemptionCertificate.arrayBuffer(),{contentType:exemptionCertificate.type,upsert:false});
  if(uploadError){await service.from("refassign_subscriptions").update({status:"checkout_error",updated_at:new Date().toISOString()}).eq("id",pendingId);return NextResponse.json({error:"The exemption certificate could not be saved. Please try again."},{status:500});}
  const{error:taxError}=await service.from("organization_tax_exemptions").upsert({organization_id:pending.organization_id,subscription_id:pendingId,purchaser_state:purchaserState,exemption_basis:"iowa_commercial_enterprise",exclusive_commercial_use_certified:true,certificate_storage_path:storagePath,certificate_original_name:exemptionCertificate.name,status:"submitted",certified_by:user.id,certified_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"organization_id"});
  if(taxError){await service.storage.from("tax-exemption-certificates").remove([storagePath]);await service.from("refassign_subscriptions").update({status:"checkout_error",updated_at:new Date().toISOString()}).eq("id",pendingId);return NextResponse.json({error:"The tax-exemption record could not be saved. Please try again."},{status:500});}
 }
 await service.from("organization_addons").upsert({organization_id:pending.organization_id,code:"text_messaging",enabled:textingAddon,unit_amount_cents:1500,billing_interval:"month"},{onConflict:"organization_id,code"});
 const origin=request.nextUrl.origin,form=new URLSearchParams();
 form.set("mode","subscription");
 form.set("cancel_url",`${origin}/billing?checkout=cancelled&plan=${plan}`);
 form.set("customer_email",user.email||"");
 form.set("client_reference_id",pendingId);
 form.set("line_items[0][price]",price.id);
 form.set("line_items[0][quantity]","1");
 let lineIndex=1;
 if(additionalBlocks){form.set(`line_items[${lineIndex}][price]`,ADDITIONAL_OFFICIAL_BLOCK_PRICE);form.set(`line_items[${lineIndex}][quantity]`,String(additionalBlocks));lineIndex++}
 if(textingAddon){form.set(`line_items[${lineIndex}][price]`,TEXT_MESSAGING_PRICE);form.set(`line_items[${lineIndex}][quantity]`,"1")}
 form.set("subscription_data[trial_period_days]","14");
 form.set("subscription_data[metadata][refassign_subscription_id]",pendingId);
 form.set("subscription_data[metadata][user_id]",user.id);
 form.set("subscription_data[metadata][plan]",plan);
 form.set("subscription_data[metadata][organization_name]",organizationName);
 form.set("subscription_data[metadata][additional_official_blocks]",String(additionalBlocks));
 form.set("subscription_data[metadata][texting_addon]",String(textingAddon));
 form.set("subscription_data[metadata][purchaser_state]",purchaserState);
 form.set("subscription_data[metadata][tax_exemption]",purchaserState==="IA"?"iowa_commercial_enterprise":"none_recorded");
 form.set("metadata[refassign_subscription_id]",pendingId);
 form.set("metadata[user_id]",user.id);
 form.set("metadata[plan]",plan);
 form.set("metadata[purchaser_state]",purchaserState);
 form.set("payment_method_collection","always");
 const onboardingParams=new URLSearchParams({onboarding:"complete"});
 onboardingParams.set("organization",pending.organization_id);
 form.set("success_url",`${origin}/workspace?${onboardingParams.toString()}`);
 const stripeResponse=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:`Bearer ${stripeKey}`,"Content-Type":"application/x-www-form-urlencoded","Stripe-Version":"2026-02-25.clover"},body:form});
 const created=await stripeResponse.json() as {id?:string;url?:string;error?:{message?:string}};
 if(!stripeResponse.ok||!created.id||!created.url){await service.from("refassign_subscriptions").update({status:"checkout_error",updated_at:new Date().toISOString()}).eq("id",pendingId);return NextResponse.json({error:created.error?.message||"Stripe could not create checkout."},{status:502});}
 await service.from("refassign_subscriptions").update({stripe_checkout_session_id:created.id,updated_at:new Date().toISOString()}).eq("id",pendingId);
 return NextResponse.json({url:created.url});
}
