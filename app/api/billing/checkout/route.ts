import {NextRequest,NextResponse} from "next/server";
import {createServerSupabaseClient} from "../../../../lib/supabase/server";
import {createServiceClient} from "../../../../lib/supabase/admin";

const PRICES={starter:{id:"price_1UCB4LEeVYrhX6SU6oi3KrCR",limit:50,founding:false},pro:{id:"price_1UCB4SEeVYrhX6SUTdZdUcvt",limit:100,founding:false},pro_founding:{id:"price_1UCB4bEeVYrhX6SU1dql6DyJ",limit:100,founding:true},premier:{id:"price_1UCB4WEeVYrhX6SUE7cvJEQa",limit:250,founding:false}} as const;

type Plan=keyof typeof PRICES;

export async function POST(request:NextRequest){
 const stripeKey=process.env.STRIPE_SECRET_KEY;
 if(!stripeKey)return NextResponse.json({error:"Stripe is not configured."},{status:503});
 const session=await createServerSupabaseClient();
 const{data:{user}}=await session.auth.getUser();
 if(!user)return NextResponse.json({error:"Please sign in before starting a subscription."},{status:401});
 const body=await request.json().catch(()=>({})) as {plan?:Plan;organization_name?:string};
 const plan=body.plan&&PRICES[body.plan]?body.plan:null;
 if(!plan)return NextResponse.json({error:"Choose a valid RefAssign plan."},{status:400});
 const organizationName=String(body.organization_name||"").trim().slice(0,160);
 if(!organizationName)return NextResponse.json({error:"Organization name is required."},{status:400});
 const service=createServiceClient();
 const price=PRICES[plan];
 const{data:pending,error:insertError}=await service.from("refassign_subscriptions").insert({user_id:user.id,organization_name:organizationName,plan,official_limit:price.limit,stripe_price_id:price.id,status:"pending",founding_offer:price.founding}).select("id").single();
 if(insertError||!pending)return NextResponse.json({error:insertError?.message||"Could not prepare subscription."},{status:500});
 const origin=request.nextUrl.origin,form=new URLSearchParams();
 form.set("mode","subscription");
 form.set("success_url",`${origin}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
 form.set("cancel_url",`${origin}/billing?checkout=cancelled`);
 form.set("customer_email",user.email||"");
 form.set("client_reference_id",pending.id);
 form.set("line_items[0][price]",price.id);
 form.set("line_items[0][quantity]","1");
 form.set("subscription_data[trial_period_days]","14");
 form.set("subscription_data[metadata][refassign_subscription_id]",pending.id);
 form.set("subscription_data[metadata][user_id]",user.id);
 form.set("subscription_data[metadata][plan]",plan);
 form.set("subscription_data[metadata][organization_name]",organizationName);
 form.set("metadata[refassign_subscription_id]",pending.id);
 form.set("metadata[user_id]",user.id);
 form.set("metadata[plan]",plan);
 form.set("payment_method_collection","always");
 const stripeResponse=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:`Bearer ${stripeKey}`,"Content-Type":"application/x-www-form-urlencoded","Stripe-Version":"2026-02-25.clover"},body:form});
 const created=await stripeResponse.json() as {id?:string;url?:string;error?:{message?:string}};
 if(!stripeResponse.ok||!created.id||!created.url){await service.from("refassign_subscriptions").update({status:"checkout_error",updated_at:new Date().toISOString()}).eq("id",pending.id);return NextResponse.json({error:created.error?.message||"Stripe could not create checkout."},{status:502});}
 await service.from("refassign_subscriptions").update({stripe_checkout_session_id:created.id,updated_at:new Date().toISOString()}).eq("id",pending.id);
 return NextResponse.json({url:created.url});
}
