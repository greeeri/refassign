# RefAssign

Production foundation for a multi-sport officials scheduling platform, designed around soccer first.

## Current build
- Responsive admin dashboard
- Games, officials, assignments, calendar and sports/rules views
- Soccer-specific CR / AR1 / AR2 / 4th official model
- Multi-sport data model
- Supabase schema for authentication, profiles, organizations, teams, venues, games, availability and assignments
- Vercel-ready Next.js project

## Deploy on Vercel
1. Import this GitHub repository into Vercel.
2. Framework preset: Next.js.
3. Deploy.

The current UI uses sample data so the first deployment works before Supabase is connected.

## Connect Supabase
1. Create/open your Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. In Vercel project settings, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Redeploy.

Do not commit private service-role keys or database passwords to GitHub.

## Next implementation phase
- Supabase authentication and role-based portals
- Live CRUD for games and officials
- CSV schedule import
- Official availability
- Accept/decline workflow
- Conflict detection
- Smart assignment scoring
- Email notifications
