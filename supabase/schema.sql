-- =====================================================================
--  Sunny & Chomper health records: database tables and privacy rules
-- =====================================================================
--
--  HOW TO USE
--  Supabase dashboard -> SQL Editor -> New query -> paste this whole
--  file -> Run. Run it ONE time on a brand-new, empty project.
--  (If you run it again it stops with "already exists" and changes
--  nothing.)
--
--  WHAT'S IN HERE
--    household_members  who is allowed in (you and your wife)
--    dogs               one row per dog
--    treatments         the list of vaccines and medications
--    events             vet visits, reactions, allergies, illnesses, notes
--    doses              every vaccine or medication ever given
--    weights            the weight log
--    identifiers        microchip, AKC, rabies tag, town license, insurance
--    contacts           regular vet, emergency vet, breeder, and so on
--    export_log         when each backup was downloaded, and by whom
--    change_log         automatic history of every add, edit, and delete
--
--  PRIVACY IN ONE SENTENCE
--  Every table is locked so that only a logged-in person whose email is
--  in household_members can read or change anything. Everyone else,
--  including someone who has the app's address, sees nothing.
--
--  This file holds no personal data, so it is safe to keep on GitHub.
-- =====================================================================


-- ---------------------------------------------------------------------
--  Who is allowed in
-- ---------------------------------------------------------------------
-- Add your two emails here after running this file (see SETUP.md).
-- Emails are stored in lower case so "Josh@Gmail.com" still matches.
create table public.household_members (
  email         text primary key check (email = lower(email)),
  display_name  text,
  added_at      timestamptz not null default now()
);

-- Answers "is the person using the app right now in the household?"
-- Every privacy rule below asks this question.
create function public.is_household_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Only logged-in people may even ask the question.
revoke execute on function public.is_household_member() from public, anon;
grant execute on function public.is_household_member() to authenticated;


-- ---------------------------------------------------------------------
--  Dogs
-- ---------------------------------------------------------------------
create table public.dogs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,     -- full name, e.g. "Chomper Kelce"
  short_name    text,                     -- shown in tight spots, e.g. "Chomper"
  sex           text,
  breed         text,
  birth_date    date,
  collar_color  text,                     -- also the dog's color inside the app
  notes         text,
  sort_order    int not null default 0,   -- which dog shows first
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  Vaccines and medications (the list, not the doses)
-- ---------------------------------------------------------------------
-- One row per kind of thing, like "Rabies" or "Heartgard Plus".
-- Doses point at a row here, which is how the app finds the
-- "last given" date for each one.
create table public.treatments (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  kind          text not null check (kind in ('vaccine', 'medication')),
  -- Monthly meds: 30. Turns on the "Mark as given" button, which sets
  -- the next due date this many days out. Empty for everything else.
  repeat_days   int check (repeat_days > 0),
  -- Product sizes by weight, used for the "time for the next size"
  -- warning. Example: [{"label": "Green", "min_lbs": 26, "max_lbs": 50.9}]
  weight_bands  jsonb not null default '[]',
  -- Other names vet paperwork might use. Helps the Import screen
  -- guess which treatment a pasted dose belongs to.
  aliases       text[] not null default '{}',
  -- false = hide from the dashboard (the history is kept).
  active        boolean not null default true,
  sort_order    int not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  Notes and events: vet visits, reactions, allergies, illnesses
-- ---------------------------------------------------------------------
create table public.events (
  id          uuid primary key default gen_random_uuid(),
  dog_id      uuid not null references public.dogs (id) on delete restrict,
  date        date not null,
  kind        text not null check (kind in
                ('vet_visit', 'reaction', 'allergy', 'illness', 'injury', 'note')),
  title       text not null,
  clinic      text,
  vet         text,
  -- Vet findings. Example: {"temp": 99, "body_condition_score": 5}
  vitals      jsonb not null default '{}',
  details     text,
  -- true = still applies (an allergy, an ongoing condition). These
  -- show on the dashboard and the vet summary.
  ongoing     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  Doses: every vaccine or medication given
-- ---------------------------------------------------------------------
create table public.doses (
  id            uuid primary key default gen_random_uuid(),
  dog_id        uuid not null references public.dogs (id) on delete restrict,
  treatment_id  uuid not null references public.treatments (id) on delete restrict,
  event_id      uuid references public.events (id) on delete set null,  -- the vet visit, if any
  date_given    date not null,
  product_name  text,      -- brand or maker from the paperwork, e.g. "Nobivac (Merck)"
  size          text,      -- for sized meds, e.g. "Green (26-50.9 lb)"
  lot_number    text,
  lot_expires   date,
  vet           text,
  clinic        text,      -- "Home" when you give it yourself
  next_due      date,
  duration      text,      -- how long it covers, e.g. "1 year" or "28 days"
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- The same treatment can't be logged twice for one dog on one day.
  unique (dog_id, treatment_id, date_given),
  check (next_due is null or next_due >= date_given)
);


-- ---------------------------------------------------------------------
--  Weight log
-- ---------------------------------------------------------------------
create table public.weights (
  id          uuid primary key default gen_random_uuid(),
  dog_id      uuid not null references public.dogs (id) on delete restrict,
  date        date not null,
  weight_lbs  numeric(5, 2) not null check (weight_lbs > 0 and weight_lbs < 300),
  event_id    uuid references public.events (id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (dog_id, date)     -- one weight per dog per day
);


-- ---------------------------------------------------------------------
--  IDs and registrations
-- ---------------------------------------------------------------------
create table public.identifiers (
  id          uuid primary key default gen_random_uuid(),
  dog_id      uuid not null references public.dogs (id) on delete restrict,
  kind        text not null check (kind in
                ('microchip', 'akc', 'rabies_tag', 'town_license', 'insurance', 'other')),
  value       text not null,   -- the number itself
  -- Microchip: the registry it's registered with. Insurance: the
  -- company. Town license: the town.
  issuer      text,
  issued_on   date,
  expires_on  date,            -- license or insurance renewal date
  details     text,            -- anything else: plan, phone, deductible
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (dog_id, kind, value)
);


-- ---------------------------------------------------------------------
--  Contacts (shared by both dogs)
-- ---------------------------------------------------------------------
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in
                ('regular_vet', 'emergency_vet', 'breeder', 'groomer',
                 'daycare', 'boarding', 'insurance', 'other')),
  name        text not null,   -- business or person
  person      text,            -- a specific vet, or the breeder's name
  phone       text,
  email       text,
  address     text,
  website     text,
  notes       text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  Backup log
-- ---------------------------------------------------------------------
-- One row each time someone downloads a backup, so every phone's
-- dashboard can say when the last one was. Who and when fill in
-- automatically.
create table public.export_log (
  id           uuid primary key default gen_random_uuid(),
  exported_at  timestamptz not null default now(),
  exported_by  text default (auth.jwt() ->> 'email'),
  kind         text not null check (kind in ('json', 'csv'))   -- full backup or spreadsheets
);


-- ---------------------------------------------------------------------
--  Keep-awake check
-- ---------------------------------------------------------------------
-- Supabase's free plan pauses a project after about 7 quiet days. A
-- free scheduled job on GitHub (.github/workflows/keep-awake.yml) calls
-- this once a day so the database stays awake. It only answers "true":
-- it reads no records, changes nothing, and works without a login.
create function public.keep_awake()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;

revoke execute on function public.keep_awake() from public;
grant execute on function public.keep_awake() to anon, authenticated;


-- ---------------------------------------------------------------------
--  Change history (the safety net)
-- ---------------------------------------------------------------------
-- Every add, edit, and delete in the tables above is copied here
-- automatically, with who did it and when. If something gets changed
-- or deleted by mistake, the old version is here to put back.
-- Nobody can edit or delete this history from the app.
create table public.change_log (
  id          bigint generated always as identity primary key,
  changed_at  timestamptz not null default now(),
  changed_by  text,                -- login email, or "database admin"
  table_name  text not null,
  row_id      uuid,
  action      text not null,       -- insert, update, or delete
  old_row     jsonb,               -- the row before the change
  new_row     jsonb                -- the row after the change
);

create function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text := coalesce(auth.jwt() ->> 'email', 'database admin');
begin
  if tg_op = 'INSERT' then
    insert into public.change_log (changed_by, table_name, row_id, action, new_row)
    values (who, tg_table_name, new.id, 'insert', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.change_log (changed_by, table_name, row_id, action, old_row, new_row)
    values (who, tg_table_name, new.id, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.change_log (changed_by, table_name, row_id, action, old_row)
    values (who, tg_table_name, old.id, 'delete', to_jsonb(old));
    return old;
  end if;
end;
$$;

-- Keeps each row's updated_at current.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger dogs_updated_at        before update on public.dogs        for each row execute function public.set_updated_at();
create trigger treatments_updated_at  before update on public.treatments  for each row execute function public.set_updated_at();
create trigger events_updated_at      before update on public.events      for each row execute function public.set_updated_at();
create trigger doses_updated_at       before update on public.doses       for each row execute function public.set_updated_at();
create trigger weights_updated_at     before update on public.weights     for each row execute function public.set_updated_at();
create trigger identifiers_updated_at before update on public.identifiers for each row execute function public.set_updated_at();
create trigger contacts_updated_at    before update on public.contacts    for each row execute function public.set_updated_at();

create trigger dogs_history        after insert or update or delete on public.dogs        for each row execute function public.log_change();
create trigger treatments_history  after insert or update or delete on public.treatments  for each row execute function public.log_change();
create trigger events_history      after insert or update or delete on public.events      for each row execute function public.log_change();
create trigger doses_history       after insert or update or delete on public.doses       for each row execute function public.log_change();
create trigger weights_history     after insert or update or delete on public.weights     for each row execute function public.log_change();
create trigger identifiers_history after insert or update or delete on public.identifiers for each row execute function public.log_change();
create trigger contacts_history    after insert or update or delete on public.contacts    for each row execute function public.log_change();


-- ---------------------------------------------------------------------
--  Speed-ups for lookups (tiny tables, but Supabase's checker asks)
-- ---------------------------------------------------------------------
create index events_dog_id_idx       on public.events (dog_id);
create index doses_treatment_id_idx  on public.doses (treatment_id);
create index doses_event_id_idx      on public.doses (event_id);
create index weights_event_id_idx    on public.weights (event_id);


-- ---------------------------------------------------------------------
--  Privacy rules
-- ---------------------------------------------------------------------
-- Turn on row-level security everywhere: with it on, a table shows
-- nothing unless a rule below allows it.
alter table public.household_members enable row level security;
alter table public.dogs              enable row level security;
alter table public.treatments        enable row level security;
alter table public.events            enable row level security;
alter table public.doses             enable row level security;
alter table public.weights           enable row level security;
alter table public.identifiers       enable row level security;
alter table public.contacts          enable row level security;
alter table public.export_log        enable row level security;
alter table public.change_log        enable row level security;

-- Household members can read, add, edit, and delete records.
create policy "household only" on public.dogs        for all to authenticated using (public.is_household_member()) with check (public.is_household_member());
create policy "household only" on public.treatments  for all to authenticated using (public.is_household_member()) with check (public.is_household_member());
create policy "household only" on public.events      for all to authenticated using (public.is_household_member()) with check (public.is_household_member());
create policy "household only" on public.doses       for all to authenticated using (public.is_household_member()) with check (public.is_household_member());
create policy "household only" on public.weights     for all to authenticated using (public.is_household_member()) with check (public.is_household_member());
create policy "household only" on public.identifiers for all to authenticated using (public.is_household_member()) with check (public.is_household_member());
create policy "household only" on public.contacts    for all to authenticated using (public.is_household_member()) with check (public.is_household_member());

-- The member list and the change history are read-only in the app.
-- (Add or remove members in the Supabase dashboard; see SETUP.md.)
create policy "household can read" on public.household_members for select to authenticated using (public.is_household_member());
create policy "household can read" on public.change_log        for select to authenticated using (public.is_household_member());

-- The backup log: household members can read it and add to it (each
-- backup adds a line), but not change or erase it.
create policy "household can read" on public.export_log for select to authenticated using (public.is_household_member());
create policy "household can add"  on public.export_log for insert to authenticated with check (public.is_household_member());

-- Belt and suspenders: start everyone at "no access", then give
-- logged-in people only the basic actions the app needs. Visitors who
-- aren't logged in ("anon") get no access to any table at all, even
-- before the rules above are checked.
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete
  on public.dogs, public.treatments, public.events, public.doses,
     public.weights, public.identifiers, public.contacts
  to authenticated;
grant select on public.household_members, public.change_log to authenticated;
grant select, insert on public.export_log to authenticated;
