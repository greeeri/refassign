import {NextRequest,NextResponse} from "next/server";
import {createServerSupabaseClient} from "../../../../lib/supabase/server";
import {createServiceClient} from "../../../../lib/supabase/admin";

const allowedOrganizationRoles=["owner","admin"];

export async function GET(request:NextRequest){
 const auth=await createServerSupabaseClient();
 const{data:{user}}=await auth.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const organizationId=request.nextUrl.searchParams.get("organization_id");
 if(!organizationId)return NextResponse.json({error:"Organization is required."},{status:400});
 const service=createServiceClient();
 const[{data:membership},{data:superAdmin}]=await Promise.all([
  service.from("organization_memberships").select("role").eq("organization_id",organizationId).eq("user_id",user.id).in("role",allowedOrganizationRoles).maybeSingle(),
  service.from("protected_accounts").select("user_id").eq("user_id",user.id).maybeSingle()
 ]);
 if(!membership&&!superAdmin)return NextResponse.json({error:"You do not have access to this organization’s tax documents."},{status:403});
 const[{data:organization},{data:documents,error}]=await Promise.all([
  service.from("organizations").select("id,name").eq("id",organizationId).single(),
  service.from("organization_tax_exemption_documents").select("id,subscription_id,original_name,mime_type,file_size_bytes,status,submitted_at,superseded_at").eq("organization_id",organizationId).order("submitted_at",{ascending:false})
 ]);
 if(error)return NextResponse.json({error:"Tax documents could not be loaded."},{status:500});
 return NextResponse.json({organization,documents:(documents||[]).map(document=>({...document,download_url:`/api/billing/tax-documents/${document.id}`}))});
}
