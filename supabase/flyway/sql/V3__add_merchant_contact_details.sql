alter table public.merchants
  add column email text,
  add column phone_number text;

with ranked_merchants as (
  select mid, row_number() over (order by mid) as position
  from public.merchants
)
update public.merchants as merchant
set
  email = case merchant.mid
    when 'MID-KOR-001' then 'koramangala.filterkapi@example.com'
    when 'MID-KOR-002' then 'koramangala.freshkart@example.com'
    when 'MID-KOR-003' then 'koramangala.udupidarshini@example.com'
    when 'MID-IND-001' then 'indiranagar.sharmaelectronics@example.com'
    when 'MID-IND-002' then 'indiranagar.apollopharmacy@example.com'
    else lower(regexp_replace(merchant.mid, '[^a-zA-Z0-9]+', '.', 'g')) || '@example.com'
  end,
  phone_number = case merchant.mid
    when 'MID-KOR-001' then '+919810000001'
    when 'MID-KOR-002' then '+919810000002'
    when 'MID-KOR-003' then '+919810000003'
    when 'MID-IND-001' then '+919810000004'
    when 'MID-IND-002' then '+919810000005'
    else '+91' || (9000000000 + ranked_merchants.position)::text
  end
from ranked_merchants
where ranked_merchants.mid = merchant.mid;

alter table public.merchants
  alter column email set not null,
  alter column phone_number set not null,
  add constraint merchants_email_unique unique (email),
  add constraint merchants_phone_number_unique unique (phone_number),
  add constraint merchants_email_format check (
    email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  add constraint merchants_phone_number_format check (
    phone_number ~ '^\+[1-9][0-9]{7,14}$'
  );
