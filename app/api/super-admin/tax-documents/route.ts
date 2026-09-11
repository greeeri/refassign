import {NextRequest,NextResponse} from "next/server";
import {requireSuperAdmin} from "../../../../lib/supabase/admin";

const deletableSubscriptionStatuses=new Set(["pending","checkout_error","canceled"]);

export async function GET(){
 try{
  const{service}=await requireSuperAdmin();
  const{data,error}=await service.from("organization_tax_exemption_documents").select("id,organization_id,subscription_id,original_name,mime_type,file_size_bytes,status,submitted_at,superseded_at,organizations(name)").order("submitted_at",{ascending:false});
  if(error)throw error;
  const subscriptionIds=(data||[]).map(document=>document.subscription_id).filter(Boolean) as string[];
  const{data:subscriptions}=subscriptionIds.length?await service.from("refassign_subscriptions").select("id,status").in("id",subscriptionIds):{data:[]};
  const statusBySubscription=new Map((subscriptions||[]).map(subscription=>[subscription.id,subscription.status]));
  return NextResponse.json({documents:(data||[]).map(document=>{const subscriptionStatus=document.subscription_id?statusBySubscription.get(document.subscription_id)||null:null;return {...document,subscription_status:subscriptionStatus,can_delete:subscriptionStatus?deletableSubscriptionStatuses.has(subscriptionStatus):false,download_url:`/api/billing/tax-documents/${document.id}`}})});
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:"Tax documents could not be loaded."},{status:403});
 }
}

export async function DELETE(request:NextRequest){
 try{
  const{user,service}=await requireSuperAdmin();
  const{id}=await request.json() as{id?:string};
  if(!id)return NextResponse.json({error:"Tax document is required."},{status:400});
  const{data:document,error}=await service.from("organization_tax_exemption_documents").select("id,organization_id,subscription_id,storage_path,original_name,status").eq("id",id).maybeSingle();
  if(error||!document)return NextResponse.json({error:"Tax document not found."},{status:404});
  if(!document.subscription_id)return NextResponse.json({error:"This archived tax record is protected from deletion."},{status:400});
  const{data:subscription}=await service.from("refassign_subscriptions").select("status").eq("id",document.subscription_id).maybeSingle();
  if(!subscription||!deletableSubscriptionStatuses.has(subscription.status))return NextResponse.json({error:"Only test records tied to pending, canceled, or failed checkouts can be deleted."},{status:400});
  const{data:current}=await service.from("organization_tax_exemptions").select("certificate_storage_path").eq("organization_id",document.organization_id).maybeSingle();
  if(current?.certificate_storage_path===document.storage_path){
   const{error:currentDeleteError}=await service.from("organization_tax_exemptions").delete().eq("organization_id",document.organization_id);
   if(currentDeleteError)throw currentDeleteError;
  }
  const{error:documentDeleteError}=await service.from("organization_tax_exemption_documents").delete().eq("id",document.id);
  if(documentDeleteError)throw documentDeleteError;
  const{error:storageError}=await service.storage.from("tax-exemption-certificates").remove([document.storage_path]);
  await service.from("super_admin_audit").insert({actor_user_id:user.id,action:"test_tax_document_deleted",details:{document_id:document.id,organization_id:document.organization_id,subscription_id:document.subscription_id,original_name:document.original_name,subscription_status:subscription.status,storage_removed:!storageError}});
  if(storageError)return NextResponse.json({deleted:true,warning:"The record was deleted, but its private storage object requires manual cleanup."});
  return NextResponse.json({deleted:true});
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:"The test tax record could not be deleted."},{status:403});
 }
}
