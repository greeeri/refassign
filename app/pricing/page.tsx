import Link from "next/link";
import styles from "./pricing.module.css";

const plans: Array<{key:string;name:string;price:string;capacity:string;description:string;popular?:boolean}> = [
  {key:"starter",name:"Starter",price:"$299",capacity:"Up to 50 officials",description:"Core scheduling and assignment tools for growing organizations."},
  {key:"pro",name:"Pro",price:"$599",capacity:"Up to 100 officials",description:"Expanded operations, reporting, payroll, and communication tools.",popular:true},
  {key:"premier",name:"Premier",price:"$999",capacity:"Up to 250 officials",description:"Advanced tools and scale for larger assigning organizations."},
];

export default function PricingPage(){
 return <main className={styles.page}>
  <nav className={styles.nav}><Link href="/">← Ref Pro Group</Link><Link href="/login">Sign in</Link></nav>
  <header className={styles.hero}><span>REFASSIGN PRICING</span><h1>Simple annual plans built around your organization.</h1><p>Officials use RefAssign at no cost. Organization plans include a 14-day free trial.</p></header>
  <section className={styles.grid}>
   {plans.map(plan=><article className={`${styles.card} ${plan.popular?styles.popular:""}`} key={plan.key}>
    {plan.popular&&<b className={styles.ribbon}>Most popular</b>}<h2>{plan.name}</h2><div className={styles.price}>{plan.price}<small>/ year</small></div><strong>{plan.capacity}</strong><p>{plan.description}</p><ul><li>✓ Game and assignment management</li><li>✓ Official availability and profiles</li><li>✓ Organization administration</li><li>✓ Reporting and payroll tools</li></ul><Link href={`/billing?plan=${plan.key}`}>Ready to Get Started →</Link>
   </article>)}
  </section>
  <p className={styles.addons}>Need more capacity? Add officials in blocks of 25 for $50 per year. Text messaging is available for $180 per year.</p>
  <section className={styles.enterprise}><div><span>ENTERPRISE</span><h2>More than 250 officials?</h2><p>Contact us for custom capacity, onboarding, integrations, and development options.</p></div><a href="mailto:Erin.Green@ref-assign.com">Contact Ref Pro Group</a></section>
  <footer>© 2026 Ref Pro Group, LLC. All rights reserved.</footer>
 </main>
}
