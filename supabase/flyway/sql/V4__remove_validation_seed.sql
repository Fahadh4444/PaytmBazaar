delete from public.payment_events
where txn_id like 'TXN-DEMO-%';

delete from public.merchants
where mid in (
  'MID-KOR-001',
  'MID-KOR-002',
  'MID-KOR-003',
  'MID-IND-001',
  'MID-IND-002'
);
