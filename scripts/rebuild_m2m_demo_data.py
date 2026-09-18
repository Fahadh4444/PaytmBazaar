#!/usr/bin/env python3
"""Rebuild the synthetic Paytm Bazaar dataset so M2M cohorts can be demonstrated.

The previous dataset had exactly one merchant per Bazaar and category, so the
M2M primary cohort (same Bazaar + same category) never had peers. This script
restructures merchants and regenerates payment events against the EXISTING
schema. It does not touch table definitions, the `merchant_daily_metrics`
view, the Data Adapter or the M2M engine.

The M2M engine needs MIN_COHORT_SIZE = 5 peers besides the merchant itself, so
a primary cohort needs 6 merchants of one category in one Bazaar:

  * 8 Bazaar+category groups of 6 merchants  -> 48 merchants with primary cohorts
  * 1 kirana in each of the 6 Bazaars        ->  6 merchants on the city fallback
  * 2 electronics shops in the whole city    ->  2 merchants with too few peers

Deliberate scenarios, over the last 7 days vs the 7 before (see SCENARIOS):
  koramangala restaurants   one merchant falls ~25% while its peers grow
  indiranagar               restaurants and fashion grow together
  marathahalli              textiles and the whole Bazaar decline
  jayanagar bakeries        one merchant grows while its peers decline
  hsr-layout cafes          network evening demand grows; one cafe's evenings fall
Everything else follows natural, randomised trends.

All data is synthetic. Names are invented, emails use example.com, and phone
numbers are sequential placeholders. None of it is Paytm production data.

Stages (nothing is written unless --write is given):
  1. read the live database and back it up to data/backups/<timestamp>/
  2. map existing MIDs onto the new plan (existing IDs are kept where possible)
  3. generate and validate the new dataset locally, including the schema's
     CHECK constraints, and write it to --output-dir as CSV
  4. with --write: replace payment events and merchants in Supabase
  5. with --write: validate the live tables, including that the
     merchant_daily_metrics view matches a rollup recomputed from raw events

Usage:
  python3 scripts/rebuild_m2m_demo_data.py            # backup + generate + validate
  python3 scripts/rebuild_m2m_demo_data.py --write    # ...and write to Supabase
"""

from __future__ import annotations

import argparse
import collections
import csv
import gzip
import json
import math
import os
import random
import re
import ssl
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_demo_data import (  # noqa: E402  (shared constants from the original generator)
    IST,
    TIME_WEIGHTS,
    WEATHER_PROBABILITIES,
    load_env_file,
    stable_int,
    weighted_choice,
)

ROOT = Path(__file__).resolve().parents[1]
MIN_PEERS = 5  # mirrors MIN_COHORT_SIZE in m2m-engine/config.ts; read-only here

# --- Plan -------------------------------------------------------------------

# (bazaar, category, merchant count, scenario)
GROUPS: tuple[tuple[str, str, int, str], ...] = (
    ("koramangala", "restaurant", 6, "underperformer"),
    ("koramangala", "cafe", 6, "steady_up"),
    ("koramangala", "kirana", 1, "kirana"),
    ("indiranagar", "restaurant", 6, "network_up"),
    ("indiranagar", "fashion", 6, "network_up"),
    ("indiranagar", "kirana", 1, "kirana"),
    ("hsr-layout", "cafe", 6, "evening_shift"),
    ("hsr-layout", "kirana", 1, "kirana"),
    ("jayanagar", "bakery", 6, "outperformer"),
    ("jayanagar", "kirana", 1, "kirana"),
    ("marathahalli", "textiles", 6, "network_decline"),
    ("marathahalli", "kirana", 1, "kirana"),
    ("marathahalli", "electronics", 1, "decline_member"),
    ("electronic-city", "restaurant", 6, "mixed"),
    ("electronic-city", "kirana", 1, "kirana"),
    ("electronic-city", "electronics", 1, "mixed"),
)

# Current-week demand change per merchant, by position in its group. Position
# 0 is the scenario's focal merchant. Realised growth differs: counts, basket
# sizes, weather and events are all random, and one merchant's week-over-week
# GMV change varies by roughly ±10 points on noise alone. Scenario effects are
# sized to stay visible through that noise.
SCENARIOS: dict[str, list[float]] = {
    "underperformer": [-0.25, 0.11, 0.16, 0.12, 0.19, 0.09],
    "steady_up": [0.04, 0.07, 0.10, 0.05, 0.08, 0.03],
    "network_up": [0.12, 0.14, 0.09, 0.16, 0.11, 0.13],
    "evening_shift": [0.00, 0.04, 0.05, 0.03, 0.06, 0.04],
    "outperformer": [0.20, -0.16, -0.19, -0.14, -0.17, -0.15],
    "network_decline": [-0.18, -0.13, -0.21, -0.15, -0.11, -0.17],
    "decline_member": [-0.12],
}
KIRANA_GROWTH = {
    "koramangala": 0.05, "indiranagar": 0.07, "hsr-layout": 0.02,
    "jayanagar": -0.05, "marathahalli": -0.08, "electronic-city": 0.01,
}
# hsr-layout cafes, current week only: evening demand grows across the network,
# while the focal cafe loses evening trade and gains mornings.
EVENING_SHIFT = {"focal": {"evening": 0.70, "morning": 1.16}, "peer": {"evening": 1.35}}

# Category economics: (daily transactions, average ticket in rupees)
CATEGORY_PROFILE = {
    "restaurant": (42, 330), "cafe": (38, 190), "kirana": (46, 320), "bakery": (32, 230),
    "fashion": (18, 1250), "textiles": (16, 1450), "electronics": (10, 2800),
}
WEEKEND = {"restaurant": 1.20, "cafe": 1.12, "bakery": 1.15, "kirana": 1.03,
           "fashion": 1.30, "textiles": 1.25, "electronics": 1.20}
RAIN = {  # (rain, heavy_rain) demand multipliers: mild, category-dependent
    "restaurant": (0.94, 0.86), "cafe": (0.97, 0.90), "bakery": (0.96, 0.90),
    "kirana": (1.06, 1.10), "fashion": (0.86, 0.72), "textiles": (0.87, 0.74),
    "electronics": (0.90, 0.80),
}
EVENT_EFFECT = {
    "festival": {"restaurant": 1.30, "cafe": 1.15, "bakery": 1.35, "kirana": 1.25,
                 "fashion": 1.35, "textiles": 1.40, "electronics": 1.30},
    "public_holiday": {"restaurant": 1.20, "cafe": 1.12, "bakery": 1.10, "kirana": 0.95,
                       "fashion": 1.20, "textiles": 1.15, "electronics": 1.10},
}
REFUND_RATE = {"restaurant": 0.006, "cafe": 0.005, "bakery": 0.006, "kirana": 0.008,
               "fashion": 0.025, "textiles": 0.022, "electronics": 0.03}

NAMES = {
    "restaurant": ["Tiffin Theory", "Masala Mile", "Ragi Room", "Coastal Plate", "Biryani Borough",
                   "Dosa Depot", "Curry Compass", "Thali Terrace", "Pepper Pot Kitchen", "Neer Dosa Den",
                   "Tandoor Trail", "Saaru Station", "Ghee Roast Corner", "Mess Meals Co", "Upma Union",
                   "Kebab Crossing", "Chutney Chapter", "Idli Inn"],
    "cafe": ["Brew Basin", "Decoction Desk", "Chicory Corner", "Kaapi Circuit", "Roast Radius",
             "Filter Fold", "Steam Stories", "Bean Bench", "Mocha Mandi", "Cup Culture",
             "Drip District", "Frothy Fern"],
    "kirana": ["Daily Needs Mart", "Ration Row", "Corner Provisions", "Pantry Point",
               "Staples Stop", "Grain & Greens"],
    "fashion": ["Thread Theory", "Style Sutra", "Kurta Kraft", "Denim Dock", "Hemline House", "Drape Studio"],
    "bakery": ["Crumb Court", "Rusk Republic", "Bun Bazaar", "Oven Oasis", "Puff Parade", "Honey Loaf"],
    "textiles": ["Silk Route Sarees", "Loom Lane", "Handloom Hub", "Weave World", "Cotton Canopy", "Zari Gallery"],
    "electronics": ["Circuit Stop", "Gadget Grove"],
}

# --- Supabase REST ------------------------------------------------------------


def ssl_context() -> ssl.SSLContext:
    """Verified TLS. python.org builds ship without a CA bundle, so find one."""
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pem = Path("/etc/ssl/cert.pem")
        return ssl.create_default_context(cafile=str(pem)) if pem.exists() else ssl.create_default_context()


class Rest:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1/"
        self.key = key
        self.ctx = ssl_context()

    def request(self, method: str, path: str, body: Any = None, headers: dict[str, str] | None = None):
        req = urllib.request.Request(
            self.base + path,
            method=method,
            data=None if body is None else json.dumps(body, separators=(",", ":")).encode(),
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                **(headers or {}),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120, context=self.ctx) as res:
                raw = res.read()
                return (json.loads(raw) if raw else None), res.headers
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase {method} {path.split('?')[0]} failed: {exc.code} {detail}") from exc

    def count(self, table: str, query: str = "") -> int:
        _, headers = self.request("GET", f"{table}?select=*&limit=1{query}", headers={"Prefer": "count=exact"})
        return int(headers["content-range"].split("/")[1])

    def read_all(self, table: str, order: str, select: str = "*") -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        while True:
            batch, _ = self.request("GET", f"{table}?select={select}&order={order}&limit=1000&offset={len(rows)}")
            rows.extend(batch)
            if len(batch) < 1000:
                return rows

    def insert(self, table: str, rows: Sequence[dict[str, Any]], upsert_on: str | None = None, batch: int = 1000):
        path = table + (f"?on_conflict={upsert_on}" if upsert_on else "")
        prefer = "return=minimal" + (",resolution=merge-duplicates" if upsert_on else "")
        for start in range(0, len(rows), batch):
            self.request("POST", path, rows[start:start + batch], headers={"Prefer": prefer})

    def delete(self, table: str, query: str):
        self.request("DELETE", f"{table}?{query}", headers={"Prefer": "return=minimal"})


def connect(env_file: Path) -> Rest:
    load_env_file(env_file)
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.")
    return Rest(url, key)


# --- Stage 1: backup ----------------------------------------------------------


def backup(db: Rest, directory: Path) -> dict[str, Any]:
    directory.mkdir(parents=True, exist_ok=False)
    tables = {
        "bazaars": "id",
        "merchants": "mid",
        "payment_events": "txn_id",
        "merchant_daily_metrics": "business_date,mid",
    }
    manifest: dict[str, Any] = {"taken_at": datetime.now(timezone.utc).isoformat(), "tables": {}}
    for table, order in tables.items():
        rows = db.read_all(table, order)
        expected = db.count(table)
        if len(rows) != expected:
            raise RuntimeError(f"Backup of {table} read {len(rows)} rows, table has {expected}.")
        path = directory / f"{table}.json.gz"
        with gzip.open(path, "wt", encoding="utf-8") as handle:
            json.dump(rows, handle)
        manifest["tables"][table] = {"rows": len(rows), "file": path.name}
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


# --- Stage 2: merchants ---------------------------------------------------------


@dataclass
class Merchant:
    mid: str
    bazaar_id: str
    category: str
    name: str
    email: str
    phone_number: str
    scenario: str
    role: str  # "focal" or "peer"
    growth: float
    reused: bool
    daily_volume: float = 0.0
    ticket: float = 0.0
    hour_weights: list[tuple[int, float]] = field(default_factory=list)
    weekday: list[float] = field(default_factory=list)
    weekly_off: int | None = None
    upi_share: float = 0.7
    drift: float = 0.0


def plan_merchants(existing: list[dict[str, Any]], seed: int) -> tuple[list[Merchant], list[str]]:
    """Assigns every planned slot a MID, preferring an existing MID of the same
    Bazaar and category, then any unused existing MID of that Bazaar, then a new
    one continuing the Bazaar's numbering. Returns merchants and MIDs to delete."""
    by_bazaar: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    for row in sorted(existing, key=lambda r: r["mid"]):
        by_bazaar[row["bazaar_id"]].append(row)

    name_pool = {cat: list(names) for cat, names in NAMES.items()}
    merchants: list[Merchant] = []
    to_delete: list[str] = []
    phone_serial = 0

    for bazaar in dict.fromkeys(g[0] for g in GROUPS):
        pool = by_bazaar.get(bazaar, [])
        prefixes = {re.sub(r"\d{3}$", "", r["mid"]) for r in pool}
        if len(prefixes) != 1:
            raise AssertionError(f"Cannot infer a MID prefix for {bazaar}: {prefixes}")
        prefix = prefixes.pop()
        next_number = max(int(r["mid"][-3:]) for r in pool) + 1

        slots = [(cat, scen, i) for (bz, cat, n, scen) in GROUPS if bz == bazaar for i in range(n)]
        assigned: dict[int, str] = {}
        unused = list(pool)
        for index, (cat, _, _) in enumerate(slots):  # same category first
            match = next((r for r in unused if r["category"] == cat), None)
            if match:
                assigned[index] = match["mid"]
                unused.remove(match)
        for index in range(len(slots)):  # then any remaining existing MID
            if index not in assigned and unused:
                assigned[index] = unused.pop(0)["mid"]
        for index in range(len(slots)):  # then new MIDs
            if index not in assigned:
                assigned[index] = f"{prefix}{next_number:03d}"
                next_number += 1
        to_delete.extend(r["mid"] for r in unused)

        existing_mids = {r["mid"] for r in pool}
        for index, (cat, scen, position) in enumerate(slots):
            mid = assigned[index]
            phone_serial += 1
            if scen == "kirana":
                growth = KIRANA_GROWTH[bazaar]
            elif scen == "mixed":
                growth = round(random.Random(seed + stable_int(f"mixed:{mid}")).uniform(-0.08, 0.12), 3)
            else:
                growth = SCENARIOS[scen][position]
            merchants.append(Merchant(
                mid=mid,
                bazaar_id=bazaar,
                category=cat,
                name=name_pool[cat].pop(0),
                email=f"{mid.lower()}.demo@example.com",
                phone_number=f"+91920000{phone_serial:04d}",
                scenario=scen,
                role="focal" if position == 0 and scen in SCENARIOS and scen != "decline_member" else "peer",
                growth=growth,
                reused=mid in existing_mids,
            ))

    for m in merchants:
        personalise(m, seed)
    return merchants, sorted(to_delete)


def personalise(m: Merchant, seed: int) -> None:
    """Gives each merchant its own volume, basket, hours, weekly rhythm and payment mix."""
    rng = random.Random(seed + stable_int(f"profile:{m.mid}"))
    volume, ticket = CATEGORY_PROFILE[m.category]
    m.daily_volume = volume * rng.uniform(0.75, 1.30)
    m.ticket = ticket * rng.uniform(0.80, 1.25)
    m.hour_weights = [(hour, weight * rng.uniform(0.75, 1.25)) for hour, weight in TIME_WEIGHTS[m.category]]
    m.weekday = [rng.uniform(0.92, 1.08) for _ in range(7)]
    if m.category in {"fashion", "textiles", "electronics"} and rng.random() < 0.5:
        m.weekly_off = 1  # Tuesday, a common weekly off for shops
    m.upi_share = rng.uniform(0.60, 0.82) if m.category != "electronics" else rng.uniform(0.35, 0.55)
    m.drift = rng.gauss(0, 0.04)  # slow background trend over the whole history


# --- Stage 3: events ------------------------------------------------------------


@dataclass(frozen=True)
class DayContext:
    weather_day: str
    weather_evening: str
    event_name: str | None
    event_type: str | None


def day_event(day: date, bazaar: str) -> tuple[str | None, str | None]:
    if day == date(2026, 8, 15):
        return "Independence Day", "public_holiday"
    if day == date(2026, 9, 14):
        return "Ganesh Chaturthi", "festival"
    if day.day == 1 or (day + timedelta(days=1)).day == 1:
        return "Payday period", "payday"
    if bazaar == "koramangala" and day in (date(2026, 9, 12), date(2026, 9, 13)):
        return "Koramangala Food Festival", "local_event"
    if bazaar in {"indiranagar", "jayanagar"} and day.weekday() == 5 and day.day <= 7:
        return "Neighbourhood weekend market", "local_event"
    if bazaar in {"koramangala", "hsr-layout", "electronic-city"} and day in (date(2026, 8, 23), date(2026, 9, 20)):
        return "City cricket screening", "sports_event"  # evening only, see event_for
    return None, None


def build_contexts(start: date, end: date, seed: int) -> dict[tuple[str, date], DayContext]:
    labels = ("clear", "cloudy", "rain", "heavy_rain")
    contexts: dict[tuple[str, date], DayContext] = {}
    for bazaar in dict.fromkeys(g[0] for g in GROUPS):
        rng = random.Random(seed + stable_int(f"weather:{bazaar}"))
        day = start
        while day <= end:
            weights = tuple(zip(labels, WEATHER_PROBABILITIES[day.month]))
            name, kind = day_event(day, bazaar)
            contexts[(bazaar, day)] = DayContext(weighted_choice(rng, weights), weighted_choice(rng, weights), name, kind)
            day += timedelta(days=1)
    return contexts


def time_of_day(hour: int) -> str:
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 21:
        return "evening"
    return "night"


def event_for(ctx: DayContext, hour: int) -> tuple[str | None, str | None]:
    if ctx.event_type == "sports_event" and hour < 17:
        return None, None
    return ctx.event_name, ctx.event_type


def generate_events(merchants: list[Merchant], start: date, end: date, seed: int) -> list[dict[str, Any]]:
    contexts = build_contexts(start, end, seed)
    current_from = end - timedelta(days=6)
    total_days = (end - start).days + 1
    as_of = datetime.combine(end + timedelta(days=1), time(12, 0), tzinfo=IST)
    last_moment = datetime.combine(end, time(23, 30), tzinfo=IST)
    modes_other = (("DC", 0.35), ("CC", 0.30), ("PPI", 0.20), ("NB", 0.15))
    rows: list[dict[str, Any]] = []
    serial = 0

    def settle(at: datetime, rng: random.Random) -> tuple[str, str | None]:
        when = at.replace(hour=0, minute=0, second=0) + timedelta(days=1, hours=6, minutes=rng.randrange(0, 240))
        if when > as_of or rng.random() < 0.03:
            return "PENDING", None
        return "SETTLED", when.isoformat()

    for m in sorted(merchants, key=lambda x: x.mid):
        rng = random.Random(seed + stable_int(f"events:{m.mid}"))
        orders = 0
        day = start
        while day <= end:
            ctx = contexts[(m.bazaar_id, day)]
            in_current = day >= current_from
            if m.weekly_off == day.weekday():
                day += timedelta(days=1)
                continue

            base = m.daily_volume * m.weekday[day.weekday()] * (1 + m.drift * (day - start).days / total_days)
            if day.weekday() >= 5:
                base *= WEEKEND[m.category]
            if in_current:
                base *= 1 + m.growth
            total_weight = sum(w for _, w in m.hour_weights)

            for anchor, weight in m.hour_weights:
                weather = ctx.weather_day if anchor < 15 else ctx.weather_evening
                mean = base * weight / total_weight
                if weather in ("rain", "heavy_rain"):
                    mean *= RAIN[m.category][weather == "heavy_rain"]
                name, kind = event_for(ctx, anchor)
                if kind in EVENT_EFFECT:
                    mean *= EVENT_EFFECT[kind][m.category]
                elif kind == "payday":
                    mean *= 1.15 if m.category in {"fashion", "textiles", "electronics"} else 1.04
                elif kind == "local_event":
                    mean *= 1.25 if m.category in {"restaurant", "cafe", "bakery"} else 1.08
                elif kind == "sports_event":
                    mean *= 1.30 if m.category in {"restaurant", "cafe"} else 1.0
                segment = time_of_day(anchor)
                if day.weekday() == 5 and segment == "evening" and m.category in {"restaurant", "cafe"}:
                    mean *= 1.15  # Saturday evenings
                if in_current and m.scenario == "evening_shift":
                    mean *= EVENING_SHIFT["focal" if m.role == "focal" else "peer"].get(segment, 1.0)

                count = max(0, round(rng.gauss(mean, math.sqrt(mean)))) if mean > 0 else 0
                for _ in range(count):
                    hour = min(23, anchor + rng.randrange(0, 3))
                    at = datetime.combine(day, time(hour, rng.randrange(60), rng.randrange(60)), tzinfo=IST)
                    ev_name, ev_type = event_for(ctx, hour)
                    wx = ctx.weather_day if hour < 15 else ctx.weather_evening
                    amount = m.ticket * rng.lognormvariate(-0.06, 0.36)
                    if ev_type == "festival" and m.category in {"fashion", "textiles", "electronics", "bakery"}:
                        amount *= 1.12
                    amount = float(max(20, round(amount / 5) * 5))
                    mode = "UPI" if rng.random() < m.upi_share else weighted_choice(rng, modes_other)
                    marker = rng.random()
                    if marker < 0.935:
                        status, code = "TXN_SUCCESS", "01"
                        settlement, settled_at = settle(at, rng)
                    elif marker < 0.955:
                        status, code, settlement, settled_at = "PENDING", "402", "PENDING", None
                    else:
                        status, code = "TXN_FAILURE", rng.choice(("227", "295", "810"))
                        settlement, settled_at = "NOT_ELIGIBLE", None
                    serial += 1
                    orders += 1
                    order_id = f"ORD-{m.mid}-{day:%Y%m%d}-{orders:05d}"
                    row = {
                        "txn_id": f"TXN-{day:%Y%m%d}-{serial:09d}",
                        "mid": m.mid,
                        "order_id": order_id,
                        "transaction_type": "ACQUIRING",
                        "status": status,
                        "response_code": code,
                        "amount_inr": amount,
                        "refund_amount_inr": 0.0,
                        "txn_at": at.isoformat(),
                        "payment_mode": mode,
                        "settlement_status": settlement,
                        "settlement_at": settled_at,
                        "weather_condition": wx,
                        "event_name": ev_name,
                        "event_type": ev_type,
                    }
                    rows.append(row)

                    if status == "TXN_SUCCESS" and rng.random() < REFUND_RATE[m.category]:
                        refund_at = at + timedelta(hours=rng.uniform(2, 72))
                        if refund_at > last_moment:
                            continue
                        refund_ctx = contexts[(m.bazaar_id, refund_at.date())]
                        r_name, r_type = event_for(refund_ctx, refund_at.hour)
                        partial = rng.random() < 0.3
                        refund = round(amount * rng.uniform(0.2, 0.6), 2) if partial else amount
                        r_settlement, r_settled_at = settle(refund_at, rng)
                        serial += 1
                        rows.append({
                            **row,
                            "txn_id": f"RTXN-{refund_at:%Y%m%d}-{serial:09d}",
                            "transaction_type": "REFUND",
                            "status": "TXN_SUCCESS",
                            "response_code": "01",
                            "refund_amount_inr": refund,
                            "txn_at": refund_at.isoformat(),
                            "settlement_status": r_settlement,
                            "settlement_at": r_settled_at,
                            "weather_condition": refund_ctx.weather_day if refund_at.hour < 15 else refund_ctx.weather_evening,
                            "event_name": r_name,
                            "event_type": r_type,
                        })
            day += timedelta(days=1)

    rows.sort(key=lambda r: (r["txn_at"], r["mid"], r["txn_id"]))
    return rows


# --- Validation -----------------------------------------------------------------

ENUMS = {
    "category": {"restaurant", "cafe", "kirana", "pharmacy", "bakery", "electronics", "fashion", "textiles"},
    "transaction_type": {"ACQUIRING", "REFUND"},
    "status": {"TXN_SUCCESS", "PENDING", "TXN_FAILURE"},
    "payment_mode": {"UPI", "CC", "DC", "PPI", "NB"},
    "settlement_status": {"PENDING", "SETTLED", "NOT_ELIGIBLE"},
    "weather_condition": {"clear", "cloudy", "rain", "heavy_rain"},
    "event_type": {"festival", "public_holiday", "local_event", "sports_event", "payday"},
}
EMAIL = re.compile(r"^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$", re.IGNORECASE)
PHONE = re.compile(r"^\+[1-9][0-9]{7,14}$")


def ist_date(timestamp: str) -> date:
    return datetime.fromisoformat(timestamp).astimezone(IST).date()


def check_constraints(bazaar_ids: set[str], merchants: list[dict[str, Any]], events: list[dict[str, Any]]) -> None:
    """Every CHECK, UNIQUE and FK rule from the schema, applied locally before any write."""
    def need(ok: bool, message: str):
        if not ok:
            raise AssertionError(message)

    mids = [m["mid"] for m in merchants]
    need(len(mids) == len(set(mids)), "duplicate merchant MID")
    need(len({m["email"] for m in merchants}) == len(merchants), "duplicate email")
    need(len({m["phone_number"] for m in merchants}) == len(merchants), "duplicate phone number")
    for m in merchants:
        need(m["bazaar_id"] in bazaar_ids, f"{m['mid']}: unknown bazaar {m['bazaar_id']}")
        need(m["category"] in ENUMS["category"], f"{m['mid']}: bad category")
        need(bool(EMAIL.match(m["email"])), f"{m['mid']}: bad email")
        need(bool(PHONE.match(m["phone_number"])), f"{m['mid']}: bad phone")

    known = set(mids)
    txn_ids = [e["txn_id"] for e in events]
    need(len(txn_ids) == len(set(txn_ids)), "duplicate txn_id")
    for e in events:
        need(e["mid"] in known, f"{e['txn_id']}: unknown MID")
        for column in ("transaction_type", "status", "payment_mode", "settlement_status", "weather_condition"):
            need(e[column] in ENUMS[column], f"{e['txn_id']}: bad {column}")
        need(e["event_type"] is None or e["event_type"] in ENUMS["event_type"], f"{e['txn_id']}: bad event_type")
        need((e["event_name"] is None) == (e["event_type"] is None), f"{e['txn_id']}: event name/type mismatch")
        need(e["amount_inr"] >= 0, f"{e['txn_id']}: negative amount")
        need(0 <= e["refund_amount_inr"] <= e["amount_inr"], f"{e['txn_id']}: refund out of range")
        need((e["transaction_type"] == "REFUND" and e["refund_amount_inr"] > 0)
             or (e["transaction_type"] == "ACQUIRING" and e["refund_amount_inr"] == 0),
             f"{e['txn_id']}: refund amount inconsistent with type")
        need((e["settlement_status"] == "SETTLED") == (e["settlement_at"] is not None),
             f"{e['txn_id']}: settlement status/time mismatch")


def rollup(events: Iterable[dict[str, Any]]) -> dict[tuple[str, str], dict[str, float]]:
    """Recomputes merchant_daily_metrics exactly as the view defines it, to check the view."""
    out: dict[tuple[str, str], dict[str, float]] = collections.defaultdict(
        lambda: {"successful_transactions": 0, "pending_transactions": 0, "failed_transactions": 0,
                 "gross_sales_inr": 0.0, "refunds_inr": 0.0})
    for e in events:
        key = (e["mid"], ist_date(e["txn_at"]).isoformat())
        r = out[key]
        if e["transaction_type"] == "ACQUIRING":
            if e["status"] == "TXN_SUCCESS":
                r["successful_transactions"] += 1
                r["gross_sales_inr"] += float(e["amount_inr"])
            elif e["status"] == "PENDING":
                r["pending_transactions"] += 1
            else:
                r["failed_transactions"] += 1
        elif e["status"] == "TXN_SUCCESS":
            r["refunds_inr"] += float(e["refund_amount_inr"])
    return out


def classify_cohorts(merchants: list[dict[str, Any]], bazaars: list[dict[str, Any]]) -> dict[str, str]:
    """Which cohort rule each merchant would get: a count check only, not M2M logic."""
    city = {b["id"]: b["city"] for b in bazaars}
    result = {}
    for m in merchants:
        same_bazaar = sum(1 for p in merchants if p["mid"] != m["mid"] and p["bazaar_id"] == m["bazaar_id"]
                          and p["category"] == m["category"])
        same_city = sum(1 for p in merchants if p["mid"] != m["mid"] and city[p["bazaar_id"]] == city[m["bazaar_id"]]
                        and p["category"] == m["category"])
        result[m["mid"]] = "primary" if same_bazaar >= MIN_PEERS else "fallback" if same_city >= MIN_PEERS else "insufficient"
    return result


def summarise(bazaars, merchants, events, end: date) -> dict[str, Any]:
    cohorts = classify_cohorts(merchants, bazaars)
    per_merchant = collections.Counter(e["mid"] for e in events)
    per_day = collections.Counter(ist_date(e["txn_at"]).isoformat() for e in events)
    success = [e for e in events if e["transaction_type"] == "ACQUIRING" and e["status"] == "TXN_SUCCESS"]
    gmv = collections.Counter()
    for e in success:
        gmv[e["mid"]] += e["amount_inr"]
    days = sorted(per_day)
    return {
        "bazaars": len(bazaars),
        "merchants": len(merchants),
        "merchants_per_bazaar": dict(sorted(collections.Counter(m["bazaar_id"] for m in merchants).items())),
        "merchants_per_bazaar_category": {f"{b}/{c}": n for (b, c), n in sorted(
            collections.Counter((m["bazaar_id"], m["category"]) for m in merchants).items())},
        "cohorts": dict(collections.Counter(cohorts.values())),
        "payment_events": len(events),
        "events_per_merchant": {"min": min(per_merchant.values()), "median": statistics.median(per_merchant.values()),
                                "max": max(per_merchant.values())},
        "date_range": [days[0], days[-1]],
        "days": len(days),
        "events_per_day": {"min": min(per_day.values()), "median": statistics.median(per_day.values()),
                           "max": max(per_day.values())},
        "gmv_per_merchant_inr": {"min": round(min(gmv.values())), "median": round(statistics.median(gmv.values())),
                                 "max": round(max(gmv.values()))},
        "status_mix": dict(collections.Counter(e["status"] for e in events)),
        "refunds": sum(e["transaction_type"] == "REFUND" for e in events),
        "events_with_named_event": sum(e["event_type"] is not None for e in events),
        "weather_mix": dict(collections.Counter(e["weather_condition"] for e in events)),
    }


def growth_preview(merchants: list[Merchant], events: list[dict[str, Any]], end: date) -> list[dict[str, Any]]:
    """Plain week-over-week GMV change per merchant, to eyeball the scenarios before writing."""
    cur_from, prev_from = end - timedelta(days=6), end - timedelta(days=13)
    cur, prev = collections.Counter(), collections.Counter()
    for e in events:
        if e["transaction_type"] != "ACQUIRING" or e["status"] != "TXN_SUCCESS":
            continue
        d = ist_date(e["txn_at"])
        if d >= cur_from:
            cur[e["mid"]] += e["amount_inr"]
        elif d >= prev_from:
            prev[e["mid"]] += e["amount_inr"]
    return [{"mid": m.mid, "bazaar": m.bazaar_id, "category": m.category, "scenario": m.scenario, "role": m.role,
             "planned": m.growth, "gmv_change_pct": round((cur[m.mid] - prev[m.mid]) / prev[m.mid] * 100, 1)}
            for m in merchants]


def write_csv(path: Path, rows: Sequence[dict[str, Any]]) -> None:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


# --- Stage 4 + 5: write and verify ------------------------------------------------


def write_to_supabase(db: Rest, merchants: list[dict[str, Any]], to_delete: list[str], events: list[dict[str, Any]],
                      existing_mids: list[str]) -> None:
    # Old events go first so that no event can reference a merchant being removed.
    for mid in existing_mids:
        db.delete("payment_events", f"mid=eq.{urllib.parse.quote(mid)}")
    if db.count("payment_events"):
        raise RuntimeError("payment_events is not empty after deleting old events.")
    if to_delete:
        db.delete("merchants", "mid=in.(" + ",".join(to_delete) + ")")
    db.insert("merchants", merchants, upsert_on="mid")
    db.insert("payment_events", events)


def verify_live(db: Rest, merchants: list[dict[str, Any]], events: list[dict[str, Any]]) -> dict[str, Any]:
    live_bazaars = db.read_all("bazaars", "id")
    live_merchants = db.read_all("merchants", "mid")
    live_events = db.read_all("payment_events", "txn_id")
    live_view = db.read_all("merchant_daily_metrics", "business_date,mid")

    bazaar_ids = {b["id"] for b in live_bazaars}
    mids = {m["mid"] for m in live_merchants}
    problems: list[str] = []
    if {m["mid"] for m in merchants} != mids:
        problems.append("live merchant set differs from generated set")
    if len(live_events) != len(events):
        problems.append(f"live has {len(live_events)} events, generated {len(events)}")
    if len({e['txn_id'] for e in live_events}) != len(live_events):
        problems.append("duplicate txn_id in live data")
    if any(m["bazaar_id"] not in bazaar_ids for m in live_merchants):
        problems.append("merchant with unknown bazaar")
    if any(e["mid"] not in mids for e in live_events):
        problems.append("payment event with unknown merchant")

    expected = rollup(live_events)
    mismatched = 0
    for row in live_view:
        want = expected.get((row["mid"], row["business_date"]))
        if want is None or any(abs(float(row[k]) - want[k]) > 0.005 for k in want) or abs(
                float(row["net_sales_inr"]) - (want["gross_sales_inr"] - want["refunds_inr"])) > 0.005:
            mismatched += 1
    if len(live_view) != len(expected):
        problems.append(f"view has {len(live_view)} rows, raw events imply {len(expected)}")
    if mismatched:
        problems.append(f"{mismatched} merchant_daily_metrics rows disagree with raw events")

    return {
        "problems": problems,
        "summary": summarise(live_bazaars, live_merchants, live_events, date.today()),
        "daily_metrics_rows": len(live_view),
        "daily_metrics_match_raw_events": mismatched == 0 and len(live_view) == len(expected),
    }


# --- Main -------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seed", type=int, default=20260918)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2026, 8, 6))
    parser.add_argument("--end", type=date.fromisoformat, default=date(2026, 9, 30))
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data" / "generated" / "m2m-demo")
    parser.add_argument("--backup-root", type=Path, default=ROOT / "data" / "backups")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.local")
    parser.add_argument("--write", action="store_true", help="Replace merchants and payment events in Supabase")
    parser.add_argument("--no-backup", action="store_true", help="Skip the backup (dry runs only)")
    parser.add_argument("--verify-only", action="store_true",
                        help="Only validate the live tables against the last generated output")
    args = parser.parse_args()
    if args.write and args.no_backup:
        parser.error("--write always takes a backup first; --no-backup is for dry runs only.")

    db = connect(args.env_file)

    if args.verify_only:
        with (args.output_dir / "merchants.csv").open(encoding="utf-8") as handle:
            merchant_rows = list(csv.DictReader(handle))
        with gzip.open(args.output_dir / "payment_events.csv.gz", "rt", encoding="utf-8") as handle:
            events = list(csv.DictReader(handle))
        live = verify_live(db, merchant_rows, events)
        (args.output_dir / "live_validation.json").write_text(json.dumps(live, indent=2), encoding="utf-8")
        print(json.dumps(live, indent=2))
        if live["problems"]:
            raise RuntimeError("Live validation failed: " + "; ".join(live["problems"]))
        return 0

    # 1. Read live state and back it up.
    live_bazaars = db.read_all("bazaars", "id")
    live_merchants = db.read_all("merchants", "mid")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_dir = args.backup_root / f"pre-m2m-rebuild-{stamp}"
    if not args.no_backup:
        manifest = backup(db, backup_dir)
        print(f"backup: {backup_dir}  {json.dumps({t: v['rows'] for t, v in manifest['tables'].items()})}")

    # 2. Plan merchants from the live MIDs.
    plan, to_delete = plan_merchants(live_merchants, args.seed)
    merchant_rows = [{"mid": m.mid, "bazaar_id": m.bazaar_id, "name": m.name, "category": m.category,
                      "email": m.email, "phone_number": m.phone_number} for m in plan]

    # 3. Generate and validate locally.
    events = generate_events(plan, args.start, args.end, args.seed)
    check_constraints({b["id"] for b in live_bazaars}, merchant_rows, events)
    summary = summarise(live_bazaars, merchant_rows, events, args.end)
    preview = growth_preview(plan, events, args.end)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(args.output_dir / "merchants.csv", merchant_rows)
    write_csv(args.output_dir / "payment_events.csv.gz", events)
    report = {
        "seed": args.seed,
        "window": [args.start.isoformat(), args.end.isoformat()],
        "backup": None if args.no_backup else str(backup_dir.relative_to(ROOT)),
        "mids_reused": sum(m.reused for m in plan),
        "mids_new": sorted(m.mid for m in plan if not m.reused),
        "mids_deleted": to_delete,
        "local": summary,
        "scenarios": [p for p in preview if p["scenario"] not in {"mixed"}],
    }
    (args.output_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "scenarios"}, indent=2))
    print("\nweek-over-week GMV preview (focal merchants and group averages):")
    groups: dict[tuple[str, str], list[dict[str, Any]]] = collections.defaultdict(list)
    for p in preview:
        groups[(p["bazaar"], p["category"])].append(p)
    for (bazaar, category), items in groups.items():
        focal = [f"{p['mid']} {p['gmv_change_pct']:+}%" for p in items if p["role"] == "focal"]
        others = [p["gmv_change_pct"] for p in items if p["role"] != "focal"]
        print(f"  {bazaar:16} {category:12} {items[0]['scenario']:16} peers avg {statistics.mean(others):+.1f}%"
              f"  {' '.join(focal)}")

    if not args.write:
        print("\nDry run: nothing written to Supabase. Re-run with --write.")
        return 0

    # 4. Write.
    write_to_supabase(db, merchant_rows, to_delete, events, [m["mid"] for m in live_merchants])

    # 5. Verify live.
    live = verify_live(db, merchant_rows, events)
    (args.output_dir / "live_validation.json").write_text(json.dumps(live, indent=2), encoding="utf-8")
    print(json.dumps(live, indent=2))
    if live["problems"]:
        raise RuntimeError("Live validation failed: " + "; ".join(live["problems"]))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, AssertionError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
