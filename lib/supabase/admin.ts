import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "./server";

export function createServiceClient(){
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
 return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function requireSuperAdmin(){
 const session=await createServerSupabaseClient();
 const{data:{user}}=await session.auth.getUser();
 if(!user)throw new Error("UNAUTHORIZED");
 const service=createServiceClient();
 const{data}=await service.from("protected_accounts").select("user_id").eq("user_id",user.id).maybeSingle();
 if(!data)throw new Error("FORBIDDEN");
 return{user,service};
}
