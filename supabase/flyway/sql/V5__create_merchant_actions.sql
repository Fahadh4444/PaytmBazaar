-- Merchant actions: one row per recommended action, from proposal through
-- approval and execution to its measured outcome. The smallest addition that
-- lets the intelligence loop record what was recommended, what the merchant
-- approved, what n8n executed, and what happened next.

create table public.merchant_actions (
  id uuid primary key default gen_random_uuid(),
  mid text not null references public.merchants(mid) on update cascade on delete cascade,
  action_type text not null check (action_type in ('SCHEDULE_PROMOTION')),
  parameters jsonb not null,
  description text not null check (char_length(description) <= 500),
  -- The relevance signals and period the proposal was based on.
  basis jsonb not null,
  status text not null check (status in ('proposed', 'approved', 'executed', 'failed')),
  approved_at timestamptz,
  executed_at timestamptz,
  execution_reference text,
  execution_detail text,
  -- Measured afterwards from M2M (merchant and cohort growth after the action).
  outcome jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'proposed') = (approved_at is null)),
  check ((status in ('executed', 'failed')) = (executed_at is not null))
);

create index merchant_actions_mid_created_idx
  on public.merchant_actions(mid, created_at desc);

alter table public.merchant_actions enable row level security;

comment on table public.merchant_actions is
  'Recommended merchant actions and their outcomes for the Paytm Bazaar prototype.';
