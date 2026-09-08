import {notFound} from "next/navigation";
import {PLAN_CATALOG} from "../../lib/saas/planCatalog";
import TierTestExperience from "./TierTestExperience";

type DatabasePlan={code:string;annual_price_cents:number|null;included_officials:number|null};
const TEST_DATABASE_URL="https://slenztuopbfxqzjyrtzp.supabase.co";
const TEST_DATABASE_KEY="sb_publishable_Hz_2BH4cYmrogX3O15x2PQ_fU-0uSKZ";

async function loadDatabasePlans():Promise<DatabasePlan[]>{
 const response=await fetch(`${TEST_DATABASE_URL}/rest/v1/saas_plan_definitions?select=code,annual_price_cents,included_officials&order=code`,{headers:{apikey:TEST_DATABASE_KEY},cache:"no-store"});
 if(!response.ok)return [];
 return response.json() as Promise<DatabasePlan[]>;
}

export default async function TierTestPage(){
 const enabled=process.env.REFASSIGN_TIER_TEST_MODE==="true"||(
  process.env.VERCEL_ENV==="preview"&&
  process.env.VERCEL_GIT_COMMIT_REF==="feature/league-tier-foundation"
 );
 if(!enabled)notFound();
 const databasePlans=await loadDatabasePlans();
 const databaseConnected=databasePlans.length===Object.keys(PLAN_CATALOG).length;
 return <TierTestExperience databaseConnected={databaseConnected}/>;
}
