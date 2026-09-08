# League and subscription foundation

Status: isolated draft; not deployed and not connected to existing RefAssign screens or APIs.

## Isolation guarantees

- Work lives on `feature/league-tier-foundation`.
- The proposed SQL is under `supabase/drafts`, so the deployment migration runner will not apply it.
- No Iowa Soccer table, route, component, role function, or row-level security policy is changed.
- The TypeScript modules are not imported by the current application.
- No Stripe product, subscription, webhook, or environment variable is changed.
- `/tier-test` returns a normal not-found page unless `REFASSIGN_TIER_TEST_MODE=true` is set on a test deployment.
- The `feature/league-tier-foundation` Vercel preview blocks all existing APIs and redirects all existing pages to `/tier-test`, preventing accidental use of inherited production services.

## Decisions represented in the first slice

- Starter includes 50 officials at $299/year.
- Pro includes 100 officials at $599/year.
- The founding Pro offer includes 100 officials at $499/year.
- Premier includes 250 officials at $999/year.
- Enterprise limits and price are contract-defined.
- Additional capacity is sold in blocks of 25 officials at $50/year.
- Pro is limited to a single sport; multi-sport support begins with Premier.
- Organizations and leagues have a many-to-many coverage relationship.
- Coverage can optionally be limited by location, allowing several assignors or assigning organizations to divide one league geographically.
- Assignors can belong to several coverage records, so one assignor can manage several leagues and locations.
- League assignment requirements are effective-dated templates with ordered positions and are owned by a coverage record.
- An active official must have both logged in and accepted or declined an assignment within the rolling previous six months.
- Organization-specific overrides support negotiated Enterprise terms and grandfathering.

## Items to validate before promotion

1. Create the non-production Supabase branch and apply this draft there.
2. Test owner, admin, assignor, billing, viewer, and unrelated-user access separately.
3. Configure Vercel Preview variables to use only the branch database and enable `REFASSIGN_TIER_TEST_MODE`.
4. Promote the reviewed draft with `supabase migration new` only after those checks pass.
