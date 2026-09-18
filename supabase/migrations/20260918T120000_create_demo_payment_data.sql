create table public.bazaars (
  id text primary key,
  name text not null,
  city text not null default 'Bengaluru',
  created_at timestamptz not null default now()
);

create table public.merchants (
  mid text primary key,
  bazaar_id text not null references public.bazaars(id) on update cascade on delete restrict,
  name text not null,
  category text not null check (
    category in ('restaurant', 'cafe', 'kirana', 'pharmacy', 'bakery', 'electronics', 'fashion', 'textiles')
  ),
  created_at timestamptz not null default now()
);

create table public.payment_events (
  txn_id text primary key,
  mid text not null references public.merchants(mid) on update cascade on delete cascade,
  order_id text not null,
  transaction_type text not null check (transaction_type in ('ACQUIRING', 'REFUND')),
  status text not null check (status in ('TXN_SUCCESS', 'PENDING', 'TXN_FAILURE')),
  response_code text not null,
  amount_inr numeric(12, 2) not null check (amount_inr >= 0),
  refund_amount_inr numeric(12, 2) not null default 0 check (
    refund_amount_inr >= 0 and refund_amount_inr <= amount_inr
  ),
  txn_at timestamptz not null,
  payment_mode text not null check (payment_mode in ('UPI', 'CC', 'DC', 'PPI', 'NB')),
  settlement_status text not null check (
    settlement_status in ('PENDING', 'SETTLED', 'NOT_ELIGIBLE')
  ),
  settlement_at timestamptz,
  weather_condition text not null check (
    weather_condition in ('clear', 'cloudy', 'rain', 'heavy_rain')
  ),
  event_name text,
  event_type text check (
    event_type is null or event_type in ('festival', 'public_holiday', 'local_event', 'sports_event', 'payday')
  ),
  created_at timestamptz not null default now(),
  check ((event_name is null) = (event_type is null)),
  check (
    (transaction_type = 'REFUND' and refund_amount_inr > 0)
    or (transaction_type = 'ACQUIRING' and refund_amount_inr = 0)
  ),
  check (
    (settlement_status = 'SETTLED' and settlement_at is not null)
    or (settlement_status <> 'SETTLED' and settlement_at is null)
  )
);

create index payment_events_mid_txn_at_idx
  on public.payment_events(mid, txn_at desc);

create index payment_events_order_id_idx
  on public.payment_events(order_id);

create index payment_events_txn_at_idx
  on public.payment_events(txn_at desc);

create index payment_events_context_idx
  on public.payment_events(weather_condition, event_type)
  where event_type is not null;

alter table public.bazaars enable row level security;
alter table public.merchants enable row level security;
alter table public.payment_events enable row level security;

comment on table public.payment_events is
  'Synthetic Paytm-like payment events for the Paytm Bazaar prototype. No production Paytm data.';

create view public.merchant_daily_metrics
with (security_invoker = true)
as
select
  mid,
  (txn_at at time zone 'Asia/Kolkata')::date as business_date,
  count(*) filter (
    where transaction_type = 'ACQUIRING' and status = 'TXN_SUCCESS'
  ) as successful_transactions,
  count(*) filter (
    where transaction_type = 'ACQUIRING' and status = 'PENDING'
  ) as pending_transactions,
  count(*) filter (
    where transaction_type = 'ACQUIRING' and status = 'TXN_FAILURE'
  ) as failed_transactions,
  coalesce(sum(amount_inr) filter (
    where transaction_type = 'ACQUIRING' and status = 'TXN_SUCCESS'
  ), 0) as gross_sales_inr,
  coalesce(sum(refund_amount_inr) filter (
    where transaction_type = 'REFUND' and status = 'TXN_SUCCESS'
  ), 0) as refunds_inr,
  coalesce(sum(amount_inr) filter (
    where transaction_type = 'ACQUIRING' and status = 'TXN_SUCCESS'
  ), 0) - coalesce(sum(refund_amount_inr) filter (
    where transaction_type = 'REFUND' and status = 'TXN_SUCCESS'
  ), 0) as net_sales_inr
from public.payment_events
group by mid, (txn_at at time zone 'Asia/Kolkata')::date;
