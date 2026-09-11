import {NextResponse} from "next/server";
import {createServerSupabaseClient} from "../../../../lib/supabase/server";
import {createServiceClient} from "../../../../lib/supabase/admin";

export async function GET(){
 const auth=await createServerSupabaseClient();
 const{data:{user}}=await auth.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const service=createServiceClient();
 const{data:subscription}=await service.from("refassign_subscriptions").select("organization_id").eq("user_id",user.id).not("organization_id","is",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(!subscription?.organization_id)return NextResponse.json({exemption:null});
 const{data:exemption,error}=await service.from("organization_tax_exemptions").select("purchaser_state,exemption_basis,status,certificate_original_name,certified_at,certificate_storage_path").eq("organization_id",subscription.organization_id).maybeSingle();
 if(error)return NextResponse.json({error:"Could not load the tax-exemption record."},{status:500});
 if(!exemption)return NextResponse.json({exemption:null});
 return NextResponse.json({exemption:{purchaser_state:exemption.purchaser_state,exemption_basis:exemption.exemption_basis,status:exemption.status,certificate_original_name:exemption.certificate_original_name,certified_at:exemption.certified_at,certificate_url:"/api/billing/tax-exemption/document"}});
}
