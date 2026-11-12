# Setting up the database (one time, about 15 minutes, free)

You do this once. After that, the app on your phone, your wife's phone,
and your computers all read and write the same records.

Everything here is on Supabase's **free plan**. You won't be asked for a
credit card. If any screen asks for one, stop and check with Claude.

---

## 1. Make the Supabase project

1. Go to **supabase.com** and sign up (signing in with your GitHub account
   is easiest).
2. Click **New project**.
   - **Name:** `pup-health`
   - **Database password:** click *Generate a password* and save it in your
     password manager. The app never uses it; it's only for emergencies.
   - **Region:** East US (the one closest to you).
   - **Plan:** Free.
3. Wait a minute or two while it sets up.

## 2. Create the tables and privacy rules

1. In the left sidebar, open **SQL Editor**, then **New query**.
2. Open `supabase/schema.sql` from this folder, copy all of it, paste it in.
3. Click **Run**. You should see *Success. No rows returned.*

## 3. Say who is allowed in

Still in the SQL Editor, start a **New query**, paste this, put in your
two real login emails (lower case), and click **Run**:

```sql
insert into public.household_members (email, display_name) values
  ('your-email@example.com', 'Joshua'),
  ('your-wifes-email@example.com', 'Your wife''s name');
```

(If a name has an apostrophe, type it twice, like `'O''Brien'`.)

Only these emails can see or change anything. To add or remove someone
later, open **Table Editor → household_members**.

## 4. Load Sunny and Chomper's starter records

1. **New query** again.
2. Open `private/seed.sql` from this folder, copy all of it, paste it in.
3. Click **Run**.

To check it worked, open **Table Editor → dogs**. You should see Sunny and
Chomper Kelce. (It's safe to run this file twice; it never doubles up.)

## 5. Make your two logins

1. Left sidebar: **Authentication → Users → Add user → Create new user**.
2. Type your email and a password, and tick **Auto Confirm User**.
3. Do the same for your wife (use the same emails as step 3).

## 6. Lock the front door

**Authentication → Sign In / Providers**, then turn **off**
*Allow new users to sign up*, and save.

Now nobody else can make an account, even if they find the app.

## 7. Copy two things for the app

**Project Settings → API Keys** (and **Data API** for the URL):

- **Project URL**, which looks like `https://abcdefgh.supabase.co`
- **Publishable key**, which starts with `sb_publishable_`

Send both to Claude when building the app. They go in the app's
`config.js`.

> **Never copy the *secret* key** (starts with `sb_secret_`, or the old
> "service_role" key) anywhere. That one skips all the privacy rules.

---

## About that "publishable key"

You asked for no API keys in the app. This is the one exception, and it's
not a secret: every Supabase app has to include it, the way a store has a
street address. It only gets someone to the front door. Getting in still
takes one of your two logins, and the privacy rules from step 2 check
every single read and write against your household list. Without a login,
the database answers "permission denied." It costs nothing, and it can't
run up a bill.

## Things to know about the free plan

- **It naps.** If nobody uses the app for about 7 days, Supabase pauses
  the project. Nothing is lost. Once the app is on GitHub, a free daily
  job (`.github/workflows/keep-awake.yml`) keeps it awake, with nothing
  to set up. If it ever does pause: log in at supabase.com, open the
  project, and click **Restore** (takes a few minutes).
- **That daily job can be switched off by GitHub** if the GitHub copy
  goes 60 days without a change. The job tries to keep itself on; if
  GitHub ever shows a "workflow disabled" banner under **Actions**,
  click **Enable workflow**.
- **Backups are on you.** The free plan doesn't let you download its
  backups. That's why the app has **More → Back up**. Save a full
  backup (JSON) somewhere safe now and then (iCloud Drive, Google Drive,
  email it to yourself). The dashboard reminds you after 30 days.
- **Restoring from a backup:** `node tools/json-to-sql.mjs pup-health-backup-2026-11-12.json > restore.sql`
  (use your file's name), then paste `restore.sql` into the SQL Editor
  and click Run. It only adds rows that are missing; it never
  overwrites or deletes.
- **Undo for mistakes:** every add, edit, and delete is copied
  automatically into the `change_log` table (who, when, before and after).
  If something gets deleted by accident, the old version is there.
