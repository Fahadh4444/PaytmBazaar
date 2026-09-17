# Database schema

`supabase/migrations/` is the source of truth for what the PostgreSQL database
looks like. Every schema change is a migration; nothing is created by hand in
the Supabase dashboard.

Application-side database access lives in [`lib/supabase/`](../lib/supabase) —
that is *how the app talks to the database*, which is a separate concern from
*what the database is*.

## No migrations yet

There are none, deliberately. No feature reads or writes the database yet, and
we do not want a speculative schema of `merchants` / `transactions` / `insights`
/ `actions` tables written before the first slice shows what those rows actually
need to hold. Today merchant data comes from synthetic files behind
[`lib/paytm/`](../lib/paytm).

## Adding one

Name migrations with a UTC timestamp prefix so they order deterministically:

```
supabase/migrations/20260918T120000_add_merchants.sql
```

Apply them with the Supabase CLI (`supabase db push`) or by running the SQL
against the project. Keep each migration to one coherent change.

## Prisma

Not used. Supabase already gives us PostgreSQL, migrations and SQL tooling;
a second schema and migration layer would buy nothing here.
