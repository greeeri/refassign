import {NextResponse} from "next/server";
import {requireSuperAdmin} from "../../../../lib/supabase/admin";

export async function GET(){
 try{
  const{service}=await requireSuperAdmin();
  const{data,error}=await service.from("organization_tax_exemption_documents").select("id,organization_id,subscription_id,original_name,mime_type,file_size_bytes,status,submitted_at,superseded_at,organizations(name)").order("submitted_at",{ascending:false});
  if(error)throw error;
  return NextResponse.json({documents:(data||[]).map(document=>({...document,download_url:`/api/billing/tax-documents/${document.id}`}))});
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:"Tax documents could not be loaded."},{status:403});
 }
}
