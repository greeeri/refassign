import {NextRequest,NextResponse} from "next/server";
import {createServerSupabaseClient} from "../../../../../lib/supabase/server";
import {createServiceClient} from "../../../../../lib/supabase/admin";

export async function GET(_request:NextRequest,{params}:{params:Promise<{id:string}>}){
 const{id}=await params;
 const auth=await createServerSupabaseClient();
 const{data:{user}}=await auth.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const service=createServiceClient();
 const{data:document}=await service.from("organization_tax_exemption_documents").select("id,organization_id,storage_path,original_name").eq("id",id).maybeSingle();
 if(!document)return NextResponse.json({error:"Tax document not found."},{status:404});
 const[{data:membership},{data:superAdmin}]=await Promise.all([
  service.from("organization_memberships").select("role").eq("organization_id",document.organization_id).eq("user_id",user.id).in("role",["owner","admin"]).maybeSingle(),
  service.from("protected_accounts").select("user_id").eq("user_id",user.id).maybeSingle()
 ]);
 if(!membership&&!superAdmin)return NextResponse.json({error:"You do not have access to this tax document."},{status:403});
 const{data:signed,error}=await service.storage.from("tax-exemption-certificates").createSignedUrl(document.storage_path,60,{download:document.original_name});
 if(error||!signed?.signedUrl)return NextResponse.json({error:"The tax document could not be opened."},{status:500});
 if(superAdmin)await service.from("super_admin_audit").insert({actor_user_id:user.id,action:"tax_document_downloaded",details:{document_id:document.id,organization_id:document.organization_id}});
 return NextResponse.redirect(signed.signedUrl);
}
