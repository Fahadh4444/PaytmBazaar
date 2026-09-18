# Database schema

`supabase/migrations/` is the source of truth for what the PostgreSQL database
looks like. Every schema change is a migration; nothing is created by hand in
the Supabase dashboard.

Application-side database access lives in [`lib/supabase/`](../lib/supabase) —
that is *how the app talks to the database*, which is a separate concern from
*what the database is*.

## Current schema

`bazaars`, `merchants`, `payment_events` and the `merchant_daily_metrics` view
hold synthetic Paytm-like prototype data. The application reads them only
through the Data Adapter in [`lib/paytm/`](../lib/paytm) — see
[docs/data-adapter.md](../docs/data-adapter.md). If you rename a table or
column, `lib/paytm/adapter/supabase.ts` is the one file to update.

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
