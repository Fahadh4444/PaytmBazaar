insert into public.bazaars (id, name, city) values
  ('koramangala', 'Koramangala', 'Bengaluru'),
  ('indiranagar', 'Indiranagar', 'Bengaluru')
on conflict (id) do nothing;

insert into public.merchants (mid, bazaar_id, name, category) values
  ('MID-KOR-001', 'koramangala', 'Filter Kapi', 'cafe'),
  ('MID-KOR-002', 'koramangala', 'FreshKart', 'kirana'),
  ('MID-KOR-003', 'koramangala', 'Udupi Darshini', 'restaurant'),
  ('MID-IND-001', 'indiranagar', 'Sharma Electronics', 'electronics'),
  ('MID-IND-002', 'indiranagar', 'Apollo Pharmacy', 'pharmacy')
on conflict (mid) do nothing;

insert into public.payment_events (
  txn_id,
  mid,
  order_id,
  transaction_type,
  status,
  response_code,
  amount_inr,
  refund_amount_inr,
  txn_at,
  payment_mode,
  settlement_status,
  settlement_at,
  weather_condition,
  event_name,
  event_type
) values
  ('TXN-DEMO-0001', 'MID-KOR-001', 'ORD-DEMO-0001', 'ACQUIRING', 'TXN_SUCCESS', '01', 185.00, 0.00, '2026-09-18T08:42:16+05:30', 'UPI', 'SETTLED', '2026-09-19T06:15:00+05:30', 'cloudy', null, null),
  ('TXN-DEMO-0002', 'MID-KOR-002', 'ORD-DEMO-0002', 'ACQUIRING', 'TXN_SUCCESS', '01', 742.50, 0.00, '2026-09-18T10:17:43+05:30', 'UPI', 'SETTLED', '2026-09-19T06:18:00+05:30', 'cloudy', null, null),
  ('TXN-DEMO-0003', 'MID-KOR-003', 'ORD-DEMO-0003', 'ACQUIRING', 'TXN_SUCCESS', '01', 428.00, 0.00, '2026-09-18T13:05:28+05:30', 'DC', 'SETTLED', '2026-09-19T06:22:00+05:30', 'rain', 'India vs Australia ODI', 'sports_event'),
  ('TXN-DEMO-0004', 'MID-IND-001', 'ORD-DEMO-0004', 'ACQUIRING', 'TXN_FAILURE', '227', 3499.00, 0.00, '2026-09-18T14:26:51+05:30', 'CC', 'NOT_ELIGIBLE', null, 'rain', null, null),
  ('TXN-DEMO-0005', 'MID-IND-002', 'ORD-DEMO-0005', 'ACQUIRING', 'PENDING', '402', 612.00, 0.00, '2026-09-18T15:11:09+05:30', 'UPI', 'PENDING', null, 'rain', null, null),
  ('TXN-DEMO-0006', 'MID-KOR-002', 'ORD-DEMO-0006', 'ACQUIRING', 'TXN_SUCCESS', '01', 1268.75, 0.00, '2026-09-18T17:38:34+05:30', 'UPI', 'SETTLED', '2026-09-19T06:31:00+05:30', 'heavy_rain', 'Koramangala Food Festival', 'local_event'),
  ('TXN-DEMO-0007', 'MID-KOR-003', 'ORD-DEMO-0007', 'ACQUIRING', 'TXN_SUCCESS', '01', 895.00, 0.00, '2026-09-18T19:22:47+05:30', 'PPI', 'SETTLED', '2026-09-19T06:37:00+05:30', 'cloudy', 'India vs Australia ODI', 'sports_event'),
  ('TXN-DEMO-0008', 'MID-IND-001', 'ORD-DEMO-0008', 'ACQUIRING', 'TXN_SUCCESS', '01', 18999.00, 0.00, '2026-09-18T20:04:12+05:30', 'CC', 'SETTLED', '2026-09-19T06:42:00+05:30', 'clear', null, null),
  ('TXN-DEMO-0009', 'MID-IND-002', 'ORD-DEMO-0009', 'ACQUIRING', 'TXN_SUCCESS', '01', 347.40, 0.00, '2026-09-18T21:16:55+05:30', 'UPI', 'PENDING', null, 'clear', null, null),
  ('TXN-DEMO-0010', 'MID-KOR-002', 'ORD-DEMO-0002', 'REFUND', 'TXN_SUCCESS', '01', 742.50, 250.00, '2026-09-19T11:08:21+05:30', 'UPI', 'SETTLED', '2026-09-20T06:12:00+05:30', 'clear', null, null)
on conflict (txn_id) do nothing;
