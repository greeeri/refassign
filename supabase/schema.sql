-- RefAssign initial production schema
create extension if not exists "pgcrypto";

create table sports (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  active boolean not null default true,
  default_officials int not null default 1
);

create table sport_positions (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid references sports(id) on delete cascade not null,
  name text not null,
  sort_order int not null default 0
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  state text,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'official' check (role in ('admin','scheduler','official','school')),
  phone text,
  home_area text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table official_sports (
  official_id uuid references profiles(id) on delete cascade,
  sport_id uuid references sports(id) on delete cascade,
  certification_level text,
  primary key (official_id, sport_id)
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  sport_id uuid references sports(id) on delete set null,
  name text not null,
  level text,
  gender text
);

create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  city text,
  state text,
  latitude numeric,
  longitude numeric
);

create table games (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid references sports(id) not null,
  home_team_id uuid references teams(id),
  away_team_id uuid references teams(id),
  venue_id uuid references venues(id),
  starts_at timestamptz not null,
  level text,
  officials_needed int not null default 1,
  status text not null default 'open' check (status in ('open','partial','assigned','cancelled','completed')),
  notes text,
  created_at timestamptz not null default now()
);

create table availability (
  id uuid primary key default gen_random_uuid(),
  official_id uuid references profiles(id) on delete cascade not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('available','unavailable','preferred')),
  notes text
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade not null,
  official_id uuid references profiles(id) on delete cascade not null,
  position_id uuid references sport_positions(id),
  status text not null default 'proposed' check (status in ('proposed','accepted','declined','confirmed')),
  fee numeric(10,2),
  assigned_at timestamptz not null default now(),
  unique(game_id, official_id)
);

insert into sports(name,default_officials) values
 ('Soccer',3),('Football',5),('Basketball',2),('Baseball',2),('Softball',2),('Volleyball',2),('Wrestling',1),('Lacrosse',3),('Hockey',3),('Tennis',1)
on conflict do nothing;

insert into sport_positions(sport_id,name,sort_order)
select id,'Center Referee',1 from sports where name='Soccer';
insert into sport_positions(sport_id,name,sort_order)
select id,'Assistant Referee 1',2 from sports where name='Soccer';
insert into sport_positions(sport_id,name,sort_order)
select id,'Assistant Referee 2',3 from sports where name='Soccer';
insert into sport_positions(sport_id,name,sort_order)
select id,'4th Official',4 from sports where name='Soccer';

alter table profiles enable row level security;
alter table availability enable row level security;
alter table assignments enable row level security;

create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Officials manage own availability" on availability for all using (auth.uid() = official_id) with check (auth.uid() = official_id);
create policy "Officials view own assignments" on assignments for select using (auth.uid() = official_id);
