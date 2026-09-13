import Image from "next/image";
import Link from "next/link";
import styles from "./pricing.module.css";
import PricingSessionReset from "./PricingSessionReset";

type Plan = {
  key: string;
  name: string;
  audience: string;
  price: string;
  cadence?: string;
  popular?: boolean;
  href: string;
  action: string;
  features: string[];
};

const plans: Plan[] = [
  {
    key: "starter",
    name: "Starter",
    audience: "Perfect for small leagues & clubs",
    price: "$299",
    cadence: "per year",
    href: "/billing?new=1&plan=starter",
    action: "Ready to Get Started",
    features: ["Up to 50 officials", "Game management", "Official assignments", "Basic reporting", "Email support"],
  },
  {
    key: "pro",
    name: "Pro",
    audience: "Ideal for growing organizations",
    price: "$599",
    cadence: "per year",
    popular: true,
    href: "/billing?new=1&plan=pro",
    action: "Ready to Get Started",
    features: ["Up to 100 officials", "Game management", "Official assignments", "Payroll processing", "Advanced reporting", "Custom rules & settings", "Priority support"],
  },
  {
    key: "premier",
    name: "Premier",
    audience: "Built for larger assigning organizations",
    price: "$999",
    cadence: "per year",
    href: "/billing?new=1&plan=premier",
    action: "Ready to Get Started",
    features: ["Up to 250 officials", "All Pro features", "Multi-sport support", "Advanced analytics", "Custom integrations where available", "Priority support"],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    audience: "For state associations & large organizations",
    price: "Custom pricing",
    href: "mailto:Erin.Green@ref-assign.com?subject=RefAssign%20Enterprise%20Plan",
    action: "Contact Ref Pro Group",
    features: ["250+ officials", "All Premier features", "Custom development options", "Dedicated account manager", "Onboarding & training", "Ongoing partnership support"],
  },
];

export default function PricingPage() {
  return (
    <main className={styles.page}>
      <PricingSessionReset />
      <nav className={styles.nav}>
        <Link href="/">← Ref Pro Group</Link>
        <Link href="/login">Sign in</Link>
      </nav>

      <header className={styles.hero}>
        <div className={styles.logos}>
          <Image src="/brand/ref-pro-group-logo-final.png" alt="Ref Pro Group" width={600} height={493} priority unoptimized />
          <span aria-hidden="true" />
          <Image src="/brand/refassign-logo-transparent.png" alt="RefAssign — Assign, Develop, Manage" width={2172} height={724} priority />
        </div>
        <h1>A smarter way to manage officials.</h1>
        <p>Built by officials. Designed for assignors. Supporting the future of the game.</p>
      </header>

      <section className={styles.capabilities} aria-label="Included platform capabilities">
        <span>Game Management</span><span>Official Assignments</span><span>Payroll & Payments</span>
        <span>Reporting & Analytics</span><span>Custom Settings & Rules</span><span>Accessible Anywhere</span>
      </section>

      <section className={styles.grid}>
        {plans.map((plan) => (
          <article className={`${styles.card} ${plan.popular ? styles.popular : ""}`} key={plan.key}>
            {plan.popular ? <b className={styles.ribbon}>Most popular</b> : null}
            <h2>{plan.name}</h2>
            <p className={styles.audience}>{plan.audience}</p>
            <div className={styles.price}>{plan.price}{plan.cadence ? <small>{plan.cadence}</small> : null}</div>
            <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            {plan.href.startsWith("mailto:") ? <a href={plan.href}>{plan.action} →</a> : <Link href={plan.href}>{plan.action} →</Link>}
          </article>
        ))}
      </section>

      <section className={styles.details}>
        <article className={styles.founding}>
          <strong>Founding Organization Special</strong>
          <h2>Get Pro for $499/year</h2>
          <p>Introductory discounted rate. Lock in founding-member pricing for a limited time.</p>
          <Link href="/billing?new=1&plan=pro_founding">Claim founding pricing →</Link>
        </article>
        <article><strong>Need more officials?</strong><p>Add officials in blocks of 25 for <b>$50 per block, per year.</b></p></article>
        <article><strong>Officials are free</strong><p>Officials can create and use their accounts at no cost. Referee payroll is separate from the RefAssign subscription.</p></article>
      </section>

      <section className={styles.trial}>
        <div><h2>Try RefAssign free for 14 days</h2><p>See how easy official management can be.</p></div>
        <Link href="/billing?new=1&plan=pro">Get started today →</Link>
      </section>

      <footer>© 2026 Ref Pro Group, LLC. All rights reserved.</footer>
    </main>
  );
}
