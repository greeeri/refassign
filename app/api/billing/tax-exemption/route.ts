import {NextRequest,NextResponse} from "next/server";
import {createServerSupabaseClient} from "../../../../lib/supabase/server";
import {createServiceClient} from "../../../../lib/supabase/admin";

const PRICES={starter:{id:"price_1UEVR3EeVYrhX6SUHxQBlJF0",limit:50,founding:false},pro:{id:"price_1UEVSJEeVYrhX6SUmTGqsUda",limit:100,founding:false},pro_founding:{id:"price_1UEVTSEeVYrhX6SUKDRHOwRm",limit:100,founding:true},premier:{id:"price_1UEVWiEeVYrhX6SU6lFSx8xZ",limit:250,founding:false}} as const;
type Plan=keyof typeof PRICES;

export async function GET(){
 const auth=await createServerSupabaseClient();
 const{data:{user}}=await auth.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const service=createServiceClient();
 const{data:subscriptions}=await service.from("refassign_subscriptions").select("id,organization_id").eq("user_id",user.id).not("organization_id","is",null).order("created_at",{ascending:false});
 const organizationIds=(subscriptions||[]).map(item=>item.organization_id).filter(Boolean) as string[];
 if(!organizationIds.length)return NextResponse.json({exemption:null});
 const{data:exemption,error}=await service.from("organization_tax_exemptions").select("organization_id,subscription_id,purchaser_state,exemption_basis,status,certificate_original_name,certified_at").in("organization_id",organizationIds).order("certified_at",{ascending:false}).limit(1).maybeSingle();
 if(error)return NextResponse.json({error:"Could not load the tax-exemption record."},{status:500});
 if(!exemption)return NextResponse.json({exemption:null});
 return NextResponse.json({exemption:{subscription_id:exemption.subscription_id,purchaser_state:exemption.purchaser_state,exemption_basis:exemption.exemption_basis,status:exemption.status,certificate_original_name:exemption.certificate_original_name,certified_at:exemption.certified_at,certificate_url:`/api/billing/tax-exemption/document?subscription=${encodeURIComponent(exemption.subscription_id||"")}`}});
}

export async function POST(request:NextRequest){
 const auth=await createServerSupabaseClient();
 const{data:{user}}=await auth.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const formData=await request.formData();
 const organizationName=String(formData.get("organization_name")||"").trim().slice(0,160);
 const plan=String(formData.get("plan")||"") as Plan;
 const purchaserState=String(formData.get("purchaser_state")||"").trim().toUpperCase();
 const certified=formData.get("iowa_exemption_certified")==="true";
 const uploaded=formData.get("exemption_certificate");
 const certificate=uploaded instanceof File&&uploaded.size>0?uploaded:null;
 const requestedSubscriptionId=String(formData.get("subscription_id")||"").trim();
 if(!organizationName)return NextResponse.json({error:"Organization name is required."},{status:400});
 if(!PRICES[plan])return NextResponse.json({error:"Choose a valid RefAssign plan."},{status:400});
 if(purchaserState!=="IA")return NextResponse.json({error:"This certificate workflow is for Iowa organizations."},{status:400});
 if(!certified)return NextResponse.json({error:"Confirm the Iowa commercial-use certification before saving."},{status:400});
 if(!certificate)return NextResponse.json({error:"Attach the completed Iowa sales-tax exemption certificate."},{status:400});
 if(certificate.size>10*1024*1024)return NextResponse.json({error:"The exemption certificate must be 10 MB or smaller."},{status:400});
 if(!["application/pdf","image/jpeg","image/png"].includes(certificate.type))return NextResponse.json({error:"Upload the exemption certificate as a PDF, JPG, or PNG file."},{status:400});
 const service=createServiceClient();
 let subscriptionId=requestedSubscriptionId;
 let organizationId="";
 if(subscriptionId){
  const{data:existing}=await service.from("refassign_subscriptions").select("id,organization_id").eq("id",subscriptionId).eq("user_id",user.id).maybeSingle();
  if(!existing?.organization_id)return NextResponse.json({error:"The pending organization billing record could not be found."},{status:404});
  organizationId=existing.organization_id;
 }else{
  const price=PRICES[plan];
  const{data,error}=await service.rpc("create_pending_organization_subscription",{p_user_id:user.id,p_organization_name:organizationName,p_plan:plan,p_official_limit:price.limit,p_stripe_price_id:price.id,p_founding_offer:price.founding});
  if(error||!data)return NextResponse.json({error:error?.message||"Could not prepare the organization."},{status:500});
  subscriptionId=data;
  const{data:created}=await service.from("refassign_subscriptions").select("organization_id").eq("id",subscriptionId).eq("user_id",user.id).single();
  if(!created?.organization_id)return NextResponse.json({error:"Could not prepare the organization."},{status:500});
  organizationId=created.organization_id;
 }
 const{data:previous}=await service.from("organization_tax_exemptions").select("certificate_storage_path").eq("organization_id",organizationId).maybeSingle();
 const safeName=certificate.name.replace(/[^a-zA-Z0-9._-]/g,"-").slice(-120)||"exemption-certificate.pdf";
 const storagePath=`${organizationId}/${subscriptionId}/${Date.now()}-${safeName}`;
 const{error:uploadError}=await service.storage.from("tax-exemption-certificates").upload(storagePath,await certificate.arrayBuffer(),{contentType:certificate.type,upsert:false});
 if(uploadError)return NextResponse.json({error:"The exemption certificate could not be saved. Please try again."},{status:500});
 const certifiedAt=new Date().toISOString();
 const{error:saveError}=await service.from("organization_tax_exemptions").upsert({organization_id:organizationId,subscription_id:subscriptionId,purchaser_state:"IA",exemption_basis:"iowa_commercial_enterprise",exclusive_commercial_use_certified:true,certificate_storage_path:storagePath,certificate_original_name:certificate.name,status:"submitted",certified_by:user.id,certified_at:certifiedAt,updated_at:certifiedAt},{onConflict:"organization_id"});
 if(saveError){await service.storage.from("tax-exemption-certificates").remove([storagePath]);return NextResponse.json({error:"The tax-exemption record could not be saved. Please try again."},{status:500});}
 if(previous?.certificate_storage_path&&previous.certificate_storage_path!==storagePath)await service.storage.from("tax-exemption-certificates").remove([previous.certificate_storage_path]);
 return NextResponse.json({exemption:{subscription_id:subscriptionId,purchaser_state:"IA",status:"submitted",certificate_original_name:certificate.name,certified_at:certifiedAt,certificate_url:`/api/billing/tax-exemption/document?subscription=${encodeURIComponent(subscriptionId)}`}});
}
