import {NextRequest,NextResponse} from "next/server";
import {createServerSupabaseClient} from "../../../../../lib/supabase/server";
import {createServiceClient} from "../../../../../lib/supabase/admin";

export async function GET(request:NextRequest){
 const auth=await createServerSupabaseClient();
 const{data:{user}}=await auth.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const service=createServiceClient();
 const requestedSubscriptionId=request.nextUrl.searchParams.get("subscription");
 let subscriptionQuery=service.from("refassign_subscriptions").select("organization_id").eq("user_id",user.id).not("organization_id","is",null);
 if(requestedSubscriptionId)subscriptionQuery=subscriptionQuery.eq("id",requestedSubscriptionId);
 const{data:subscription}=await subscriptionQuery.order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(!subscription?.organization_id)return NextResponse.json({error:"No organization billing record was found."},{status:404});
 const{data:exemption}=await service.from("organization_tax_exemptions").select("certificate_storage_path").eq("organization_id",subscription.organization_id).maybeSingle();
 if(!exemption)return NextResponse.json({error:"No exemption certificate was found."},{status:404});
 const{data:signed,error}=await service.storage.from("tax-exemption-certificates").createSignedUrl(exemption.certificate_storage_path,60);
 if(error||!signed?.signedUrl)return NextResponse.json({error:"The exemption certificate could not be opened."},{status:500});
 return NextResponse.redirect(signed.signedUrl);
}
