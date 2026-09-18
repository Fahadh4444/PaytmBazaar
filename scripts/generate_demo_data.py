#!/usr/bin/env python3
"""Generate and optionally upload deterministic Paytm Bazaar demo data.

The generated records are synthetic. They resemble documented payment-event
fields but are not an export of, or access to, Paytm production data.
"""

from __future__ import annotations

import argparse
import calendar
import csv
import hashlib
import json
import math
import os
import random
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence


IST = timezone(timedelta(hours=5, minutes=30))

BAZAARS = (
    ("koramangala", "Koramangala", "Bengaluru"),
    ("indiranagar", "Indiranagar", "Bengaluru"),
    ("marathahalli", "Marathahalli", "Bengaluru"),
    ("hsr-layout", "HSR Layout", "Bengaluru"),
    ("jayanagar", "Jayanagar", "Bengaluru"),
    ("electronic-city", "Electronic City", "Bengaluru"),
)

MERCHANT_TEMPLATES = (
    ("Filter Kapi", "cafe", 34, 180),
    ("FreshKart", "kirana", 42, 310),
    ("Sharma Electronics", "electronics", 10, 2_650),
    ("Trends Fashion", "fashion", 14, 1_150),
    ("Apollo Pharmacy", "pharmacy", 28, 460),
    ("Udupi Darshini", "restaurant", 54, 285),
    ("Sri Lakshmi Textiles", "textiles", 12, 1_420),
    ("Bakers Point", "bakery", 31, 240),
)

TIME_WEIGHTS = {
    "cafe": ((8, 0.42), (12, 0.30), (17, 0.22), (20, 0.06)),
    "kirana": ((8, 0.20), (12, 0.27), (17, 0.41), (20, 0.12)),
    "electronics": ((10, 0.16), (13, 0.42), (17, 0.34), (20, 0.08)),
    "fashion": ((10, 0.15), (13, 0.40), (17, 0.37), (20, 0.08)),
    "pharmacy": ((8, 0.23), (12, 0.30), (17, 0.33), (20, 0.14)),
    "restaurant": ((8, 0.09), (12, 0.28), (17, 0.48), (21, 0.15)),
    "textiles": ((10, 0.16), (13, 0.40), (17, 0.36), (20, 0.08)),
    "bakery": ((8, 0.36), (12, 0.26), (17, 0.30), (20, 0.08)),
}

PAYMENT_MODES = (("UPI", 0.72), ("DC", 0.09), ("CC", 0.07), ("PPI", 0.06), ("NB", 0.06))

FIXED_EVENTS = {
    "01-01": ("New Year", "festival"),
    "01-14": ("Makar Sankranti", "festival"),
    "01-26": ("Republic Day", "public_holiday"),
    "08-15": ("Independence Day", "public_holiday"),
    "10-02": ("Gandhi Jayanti", "public_holiday"),
    "12-25": ("Christmas", "festival"),
}

WEATHER_PROBABILITIES = {
    1: (0.78, 0.18, 0.04, 0.00),
    2: (0.76, 0.18, 0.06, 0.00),
    3: (0.70, 0.20, 0.09, 0.01),
    4: (0.62, 0.22, 0.14, 0.02),
    5: (0.48, 0.24, 0.24, 0.04),
    6: (0.30, 0.28, 0.34, 0.08),
    7: (0.24, 0.28, 0.38, 0.10),
    8: (0.28, 0.30, 0.34, 0.08),
    9: (0.38, 0.31, 0.27, 0.04),
    10: (0.58, 0.25, 0.15, 0.02),
    11: (0.70, 0.22, 0.08, 0.00),
    12: (0.77, 0.19, 0.04, 0.00),
}


@dataclass(frozen=True)
class Merchant:
    mid: str
    bazaar_id: str
    name: str
    category: str
    email: str
    phone_number: str
    volume_mean: int
    ticket_size_mean: int
    branch_factor: float
    closure_day: int


@dataclass(frozen=True)
class DayContext:
    weather_condition: str
    event_name: str | None
    event_type: str | None


def stable_int(value: str) -> int:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:12], 16)


def parse_month(value: str) -> tuple[int, int]:
    try:
        parsed = datetime.strptime(value, "%Y-%m")
    except ValueError as exc:
        raise argparse.ArgumentTypeError("month must be YYYY-MM") from exc
    return parsed.year, parsed.month


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def weighted_choice(rng: random.Random, options: Sequence[tuple[str, float]]) -> str:
    marker = rng.random()
    cumulative = 0.0
    for value, weight in options:
        cumulative += weight
        if marker <= cumulative:
            return value
    return options[-1][0]


def build_merchants(seed: int, days_in_month: int) -> list[Merchant]:
    merchants: list[Merchant] = []
    for bazaar_index, (bazaar_id, _, _) in enumerate(BAZAARS, start=1):
        short = "".join(part[:3].upper() for part in bazaar_id.split("-"))[:6]
        for merchant_index, (name, category, base_count, aov) in enumerate(MERCHANT_TEMPLATES, start=1):
            local_rng = random.Random(seed + stable_int(f"{bazaar_id}:{category}"))
            merchants.append(
                Merchant(
                    mid=f"PBZ{short}{merchant_index:03d}",
                    bazaar_id=bazaar_id,
                    name=name,
                    category=category,
                    email=(
                        f"{bazaar_id}.{''.join(character for character in name.lower() if character.isalnum())}"
                        "@example.com"
                    ),
                    phone_number=f"+91{9100000000 + ((bazaar_index - 1) * len(MERCHANT_TEMPLATES)) + merchant_index}",
                    volume_mean=base_count,
                    ticket_size_mean=aov,
                    branch_factor=round(local_rng.uniform(0.82, 1.20), 3),
                    closure_day=1 + stable_int(f"closure:{seed}:{bazaar_index}:{merchant_index}") % days_in_month,
                )
            )
    return merchants


def load_event_overrides(path: Path | None) -> dict[tuple[date, str], tuple[str, str]]:
    if path is None:
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    overrides: dict[tuple[date, str], tuple[str, str]] = {}
    valid_types = {"festival", "public_holiday", "local_event", "sports_event", "payday"}
    bazaar_ids = {item[0] for item in BAZAARS}
    for item in payload:
        event_date = date.fromisoformat(item["date"])
        event_type = item["event_type"]
        if event_type not in valid_types:
            raise ValueError(f"Unsupported event_type: {event_type}")
        targets = item.get("bazaar_ids") or sorted(bazaar_ids)
        unknown = set(targets) - bazaar_ids
        if unknown:
            raise ValueError(f"Unknown Bazaar ids in events file: {sorted(unknown)}")
        for bazaar_id in targets:
            overrides[(event_date, bazaar_id)] = (item["event_name"], event_type)
    return overrides


def contextual_event(
    current_date: date,
    bazaar_id: str,
    overrides: dict[tuple[date, str], tuple[str, str]],
) -> tuple[str | None, str | None]:
    override = overrides.get((current_date, bazaar_id))
    if override:
        return override
    fixed = FIXED_EVENTS.get(current_date.strftime("%m-%d"))
    if fixed:
        return fixed
    if current_date.day in (1, 30, 31):
        return "Payday period", "payday"
    week_number = (current_date.day - 1) // 7 + 1
    if current_date.weekday() == 5 and week_number == 1 and bazaar_id in {
        "koramangala", "indiranagar", "jayanagar"
    }:
        return "Neighbourhood weekend market", "local_event"
    if current_date.weekday() == 6 and week_number == 3 and bazaar_id in {
        "koramangala", "hsr-layout", "electronic-city"
    }:
        return "City sports screening", "sports_event"
    return None, None


def build_contexts(
    year: int,
    month: int,
    seed: int,
    overrides: dict[tuple[date, str], tuple[str, str]],
) -> dict[tuple[str, date], DayContext]:
    contexts: dict[tuple[str, date], DayContext] = {}
    days = calendar.monthrange(year, month)[1]
    labels = ("clear", "cloudy", "rain", "heavy_rain")
    probabilities = WEATHER_PROBABILITIES[month]
    for bazaar_id, _, _ in BAZAARS:
        rng = random.Random(seed + stable_int(f"weather:{bazaar_id}:{year}-{month:02d}"))
        for day_number in range(1, days + 1):
            current_date = date(year, month, day_number)
            weather = weighted_choice(rng, tuple(zip(labels, probabilities)))
            event_name, event_type = contextual_event(current_date, bazaar_id, overrides)
            contexts[(bazaar_id, current_date)] = DayContext(
                weather_condition=weather,
                event_name=event_name,
                event_type=event_type,
            )
    return contexts


def demand_factor(merchant: Merchant, current_date: date, context: DayContext, days: int) -> float:
    factor = merchant.branch_factor
    weekend = current_date.weekday() >= 5
    if weekend:
        factor *= {
            "restaurant": 1.24, "cafe": 1.14, "bakery": 1.18,
            "fashion": 1.25, "textiles": 1.20, "electronics": 1.16,
            "kirana": 1.04, "pharmacy": 1.02,
        }[merchant.category]
    if context.weather_condition in {"rain", "heavy_rain"}:
        factor *= {
            "pharmacy": 1.24, "kirana": 1.13, "cafe": 0.94,
            "restaurant": 0.91, "bakery": 0.96, "electronics": 0.87,
            "fashion": 0.76, "textiles": 0.79,
        }[merchant.category]
    if context.event_type in {"festival", "public_holiday"}:
        factor *= {
            "restaurant": 1.36, "cafe": 1.18, "bakery": 1.30,
            "fashion": 1.32, "textiles": 1.28, "electronics": 1.20,
            "kirana": 1.22, "pharmacy": 1.04,
        }[merchant.category]
    elif context.event_type == "local_event":
        factor *= 1.30 if merchant.category in {"restaurant", "cafe", "bakery"} else 1.08
    elif context.event_type == "sports_event":
        factor *= 1.28 if merchant.category in {"restaurant", "cafe"} else 1.04
    elif context.event_type == "payday":
        factor *= 1.22 if merchant.category in {"electronics", "fashion", "textiles"} else 1.06

    last_week_start = max(1, days - 6)
    if current_date.day >= last_week_start:
        if merchant.category == "restaurant" and merchant.bazaar_id != "koramangala":
            factor *= 1.16
        if merchant.category == "restaurant" and merchant.bazaar_id == "koramangala":
            factor *= 0.76
        if merchant.category == "cafe" and merchant.bazaar_id == "indiranagar":
            factor *= 1.22
    return factor


def choose_hour(rng: random.Random, category: str) -> int:
    anchor = int(weighted_choice(rng, tuple((str(hour), weight) for hour, weight in TIME_WEIGHTS[category])))
    return min(23, anchor + rng.randrange(0, 3))


def category_amount(rng: random.Random, merchant: Merchant, context: DayContext) -> float:
    amount = merchant.ticket_size_mean * rng.lognormvariate(-0.08, 0.42)
    if context.event_type in {"festival", "public_holiday"} and merchant.category in {
        "electronics", "fashion", "textiles", "bakery"
    }:
        amount *= 1.14
    return round(max(20, amount) / 5) * 5.0


def payment_status(rng: random.Random) -> tuple[str, str]:
    marker = rng.random()
    if marker < 0.935:
        return "TXN_SUCCESS", "01"
    if marker < 0.955:
        return "PENDING", "402"
    return "TXN_FAILURE", rng.choice(("227", "295", "810"))


def transaction_row(
    txn_id: str,
    merchant: Merchant,
    order_id: str,
    txn_at: datetime,
    amount: float,
    payment_mode: str,
    status: str,
    response_code: str,
    context: DayContext,
    rng: random.Random,
) -> dict[str, Any]:
    if status == "TXN_SUCCESS":
        settlement_status = "SETTLED" if rng.random() < 0.88 else "PENDING"
        settlement_at = (
            txn_at + timedelta(days=1, hours=rng.randrange(1, 6))
            if settlement_status == "SETTLED" else None
        )
    else:
        settlement_status = "NOT_ELIGIBLE"
        settlement_at = None
    return {
        "txn_id": txn_id,
        "mid": merchant.mid,
        "order_id": order_id,
        "transaction_type": "ACQUIRING",
        "status": status,
        "response_code": response_code,
        "amount_inr": amount,
        "refund_amount_inr": 0,
        "txn_at": txn_at.isoformat(),
        "payment_mode": payment_mode,
        "settlement_status": settlement_status,
        "settlement_at": settlement_at.isoformat() if settlement_at else None,
        "weather_condition": context.weather_condition,
        "event_name": context.event_name,
        "event_type": context.event_type,
    }


def generate_payment_events(
    merchants: Sequence[Merchant],
    contexts: dict[tuple[str, date], DayContext],
    year: int,
    month: int,
    seed: int,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    days = calendar.monthrange(year, month)[1]
    serial = 1
    for merchant in merchants:
        rng = random.Random(seed + stable_int(f"payments:{merchant.mid}:{year}-{month:02d}"))
        for day_number in range(1, days + 1):
            current_date = date(year, month, day_number)
            context = contexts[(merchant.bazaar_id, current_date)]
            if day_number == merchant.closure_day and merchant.category not in {"pharmacy", "kirana"}:
                daily_count = 0
            else:
                mean = merchant.volume_mean * demand_factor(merchant, current_date, context, days)
                daily_count = max(0, min(96, round(rng.gauss(mean, max(2.0, math.sqrt(mean))))))

            successes: list[dict[str, Any]] = []
            for daily_index in range(1, daily_count + 1):
                hour = choose_hour(rng, merchant.category)
                txn_at = datetime.combine(
                    current_date,
                    time(hour, rng.randrange(0, 60), rng.randrange(0, 60)),
                    tzinfo=IST,
                )
                amount = category_amount(rng, merchant, context)
                mode = weighted_choice(rng, PAYMENT_MODES)
                status, response_code = payment_status(rng)
                txn_id = f"TXN-{year}{month:02d}{day_number:02d}-{serial:09d}"
                order_id = f"ORD-{merchant.mid[-6:]}-{year}{month:02d}{day_number:02d}-{daily_index:04d}"
                row = transaction_row(
                    txn_id, merchant, order_id, txn_at, amount, mode, status, response_code, context, rng
                )
                rows.append(row)
                serial += 1
                if status == "TXN_SUCCESS":
                    successes.append(row)

            refund_count = min(4, len(successes) // 55)
            for original in rng.sample(successes, refund_count) if refund_count else ():
                original_time = datetime.fromisoformat(original["txn_at"])
                refund_time = min(
                    original_time + timedelta(hours=rng.randrange(2, 8)),
                    datetime.combine(current_date, time(23, 55), tzinfo=IST),
                )
                refund_amount = original["amount_inr"] if rng.random() < 0.72 else round(original["amount_inr"] * 0.5, 2)
                rows.append({
                    **original,
                    "txn_id": f"RTXN-{year}{month:02d}{day_number:02d}-{serial:09d}",
                    "transaction_type": "REFUND",
                    "status": "TXN_SUCCESS",
                    "response_code": "01",
                    "amount_inr": refund_amount,
                    "refund_amount_inr": refund_amount,
                    "txn_at": refund_time.isoformat(),
                    "settlement_status": "SETTLED",
                    "settlement_at": (refund_time + timedelta(days=1)).isoformat(),
                })
                serial += 1
    rows.sort(key=lambda item: (item["txn_at"], item["mid"], item["txn_id"]))
    return rows


def merchant_rows(merchants: Sequence[Merchant]) -> list[dict[str, Any]]:
    return [
        {
            "mid": merchant.mid,
            "bazaar_id": merchant.bazaar_id,
            "name": merchant.name,
            "category": merchant.category,
            "email": merchant.email,
            "phone_number": merchant.phone_number,
        }
        for merchant in merchants
    ]


def bazaar_rows() -> list[dict[str, str]]:
    return [{"id": item[0], "name": item[1], "city": item[2]} for item in BAZAARS]


def write_csv(path: Path, rows: Sequence[dict[str, Any]]) -> None:
    if not rows:
        raise ValueError(f"Cannot write an empty dataset: {path}")
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def chunked(rows: Sequence[dict[str, Any]], size: int) -> Iterable[Sequence[dict[str, Any]]]:
    for start in range(0, len(rows), size):
        yield rows[start:start + size]


def upsert_rows(
    base_url: str,
    secret_key: str,
    table: str,
    conflict_column: str,
    rows: Sequence[dict[str, Any]],
    batch_size: int,
) -> None:
    endpoint = f"{base_url.rstrip('/')}/rest/v1/{table}?on_conflict={urllib.parse.quote(conflict_column)}"
    for batch_number, batch in enumerate(chunked(rows, batch_size), start=1):
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(batch, separators=(",", ":")).encode("utf-8"),
            method="POST",
            headers={
                "apikey": secret_key,
                "Authorization": f"Bearer {secret_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                if response.status not in (200, 201, 204):
                    raise RuntimeError(f"Unexpected Supabase status {response.status} for {table}")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase rejected {table} batch {batch_number}: {exc.code} {detail}") from exc


def validate(
    merchants: Sequence[Merchant],
    payment_events: Sequence[dict[str, Any]],
    year: int,
    month: int,
) -> dict[str, Any]:
    if len(BAZAARS) != 6 or len(merchants) != 48:
        raise AssertionError("Expected exactly 6 Bazaars and 48 merchants")
    mids = {merchant.mid for merchant in merchants}
    if len(mids) != len(merchants):
        raise AssertionError("Merchant MIDs are not unique")
    txn_ids = {row["txn_id"] for row in payment_events}
    if len(txn_ids) != len(payment_events):
        raise AssertionError("Transaction IDs are not unique")
    daily_counts: dict[tuple[str, date], int] = {}
    for row in payment_events:
        if row["mid"] not in mids:
            raise AssertionError(f"Unknown MID in payment events: {row['mid']}")
        txn_date = datetime.fromisoformat(row["txn_at"]).astimezone(IST).date()
        daily_counts[(row["mid"], txn_date)] = daily_counts.get((row["mid"], txn_date), 0) + 1
    max_daily = max(daily_counts.values(), default=0)
    if max_daily > 100:
        raise AssertionError(f"Daily event limit exceeded: {max_daily}")
    days = calendar.monthrange(year, month)[1]
    zero_days = len(merchants) * days - len(daily_counts)
    return {
        "bazaars": len(BAZAARS),
        "merchants": len(merchants),
        "payment_events": len(payment_events),
        "min_daily_events": 0 if zero_days else min(daily_counts.values()),
        "max_daily_events": max_daily,
        "zero_transaction_days": zero_days,
        "successful_acquiring": sum(
            row["transaction_type"] == "ACQUIRING" and row["status"] == "TXN_SUCCESS"
            for row in payment_events
        ),
        "failed": sum(row["status"] == "TXN_FAILURE" for row in payment_events),
        "pending": sum(row["status"] == "PENDING" for row in payment_events),
        "refunds": sum(row["transaction_type"] == "REFUND" for row in payment_events),
        "contextual_events": sum(row["event_type"] is not None for row in payment_events),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--month", default="2026-09", help="Month to generate in YYYY-MM format")
    parser.add_argument("--seed", type=int, default=20260918, help="Deterministic random seed")
    parser.add_argument("--output-dir", type=Path, default=Path("data/generated"))
    parser.add_argument("--events-file", type=Path, help="Optional JSON event overrides")
    parser.add_argument("--insert-supabase", action="store_true", help="Upsert generated data into Supabase")
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()

    year, month = parse_month(args.month)
    days = calendar.monthrange(year, month)[1]
    overrides = load_event_overrides(args.events_file)
    merchants = build_merchants(args.seed, days)
    contexts = build_contexts(year, month, args.seed, overrides)
    payments = generate_payment_events(merchants, contexts, year, month, args.seed)
    summary = validate(merchants, payments, year, month)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    bazaars = bazaar_rows()
    merchant_data = merchant_rows(merchants)
    write_csv(args.output_dir / "bazaars.csv", bazaars)
    write_csv(args.output_dir / "merchants.csv", merchant_data)
    write_csv(args.output_dir / "payment_events.csv", payments)
    (args.output_dir / "generation_summary.json").write_text(
        json.dumps({"month": args.month, "seed": args.seed, **summary}, indent=2),
        encoding="utf-8",
    )

    if args.insert_supabase:
        load_env_file(args.env_file)
        supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        secret_key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not supabase_url or not secret_key:
            raise RuntimeError(
                "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY."
            )
        upsert_rows(supabase_url, secret_key, "bazaars", "id", bazaars, args.batch_size)
        upsert_rows(supabase_url, secret_key, "merchants", "mid", merchant_data, args.batch_size)
        upsert_rows(supabase_url, secret_key, "payment_events", "txn_id", payments, args.batch_size)

    print(json.dumps({"output_dir": str(args.output_dir), **summary}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, AssertionError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
