import {notFound} from "next/navigation";
import {
  OFFICIAL_BLOCK_ANNUAL_PRICE_CENTS,
  OFFICIAL_BLOCK_SIZE,
  PLAN_CATALOG,
} from "../../lib/saas/planCatalog";
import styles from "./tier-test.module.css";

const money=(cents:number|null)=>cents===null?"Custom":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(cents/100);

export default function TierTestPage(){
 const enabled=process.env.REFASSIGN_TIER_TEST_MODE==="true"||(
  process.env.VERCEL_ENV==="preview"&&
  process.env.VERCEL_GIT_COMMIT_REF==="feature/league-tier-foundation"
 );
 if(!enabled)notFound();
 return <main className={styles.page}>
  <header className={styles.header}>
   <p className={styles.eyebrow}>Isolated test environment</p>
   <h1>League and subscription foundation</h1>
   <p>This page verifies the new RefAssign tier configuration. It does not use or modify Iowa Soccer data.</p>
  </header>
  <section className={styles.grid} aria-label="Subscription plans">
   {Object.values(PLAN_CATALOG).map(plan=><article className={styles.card} key={plan.code}>
    <div><h2>{plan.name}</h2><strong>{money(plan.annualPriceCents)}{plan.annualPriceCents!==null&&<small> / year</small>}</strong></div>
    <dl>
     <div><dt>Included officials</dt><dd>{plan.includedOfficials??"Contract-defined"}</dd></div>
     <div><dt>Sports</dt><dd>{plan.features.has("multi_sport")?"Multiple":"One"}</dd></div>
     <div><dt>Reporting</dt><dd>{plan.features.has("advanced_analytics")?"Advanced analytics":plan.features.has("advanced_reporting")?"Advanced":"Basic"}</dd></div>
     <div><dt>Payroll</dt><dd>{plan.features.has("payroll_processing")?"Included":"Not included"}</dd></div>
    </dl>
   </article>)}
  </section>
  <section className={styles.rule}>
   <h2>Capacity rules being tested</h2>
   <p><b>Active official:</b> logged in and accepted or declined an assignment during the rolling previous six months.</p>
   <p><b>Additional capacity:</b> {OFFICIAL_BLOCK_SIZE} officials for {money(OFFICIAL_BLOCK_ANNUAL_PRICE_CENTS)} per year.</p>
   <p><b>Coverage:</b> organizations and leagues are many-to-many, with optional location-specific assignor coverage.</p>
  </section>
 </main>
}
