# RefAssign

Production foundation for a multi-sport officials scheduling platform, designed around soccer first.

## Current build
- Responsive admin dashboard
- Games, officials, assignments, calendar and sports/rules views
- Soccer-specific CR / AR1 / AR2 / optional 4th Official / optional Mentor model
- Multi-sport data model
- Supabase schema for authentication, profiles, organizations, teams, venues, games, availability and assignments
- Supabase magic-link login and initial administrator role setup
- Vercel-ready Next.js project

## Deploy on Vercel
1. Import this GitHub repository into Vercel.
2. Framework preset: Next.js.
3. Deploy.

## Connect Supabase
1. Create/open your Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. Run migrations in `supabase/migrations`.
4. In Vercel project settings, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Trigger a fresh production deployment so the public variables are included in the Next.js build.

Do not commit private service-role keys or database passwords to GitHub.

## Next implementation phase
- Live CRUD for games and officials
- CSV schedule import
- Official availability
- Accept/decline workflow
- Conflict detection
- Smart assignment scoring
- Email notifications

Deployment refresh marker: 2026-08-26
