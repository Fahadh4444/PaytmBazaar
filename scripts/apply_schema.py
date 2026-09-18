"""Apply the Paytm Bazaar Supabase migration using SUPABASE_DB_URL."""

from __future__ import annotations

import os
import sys
import argparse
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MIGRATION = ROOT / "supabase" / "flyway" / "sql" / "V1__create_paytm_bazaar_tables.sql"


def load_local_env() -> None:
    env_file = ROOT / ".env.local"
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("migration", nargs="?", type=Path, default=DEFAULT_MIGRATION)
    parser.add_argument("--verify-only", action="store_true", help="Check the database without applying SQL")
    args = parser.parse_args()

    load_local_env()
    database_url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL (or DATABASE_URL) is missing from .env.local")

    import psycopg

    # Supabase's direct host uses `postgres`; the pooler uses
    # `postgres.<project-ref>`. Normalize a commonly copied mixed URL.
    parsed = urlsplit(database_url)
    username = unquote(parsed.username or "")
    if parsed.hostname and parsed.hostname.startswith("db.") and username.startswith("postgres."):
        password = quote(unquote(parsed.password or ""), safe="")
        port = f":{parsed.port}" if parsed.port else ""
        database_url = urlunsplit(
            (parsed.scheme, f"postgres:{password}@{parsed.hostname}{port}", parsed.path, parsed.query, parsed.fragment)
        )

    with psycopg.connect(database_url, connect_timeout=15) as connection:
        with connection.cursor() as cursor:
            if not args.verify_only:
                migration = args.migration if args.migration.is_absolute() else ROOT / args.migration
                cursor.execute(migration.read_text(encoding="utf-8"))

            cursor.execute(
                """
                select table_name
                from information_schema.tables
                where table_schema = 'public'
                  and table_name in ('bazaars', 'merchants', 'payment_events')
                order by table_name
                """
            )
            tables = [row[0] for row in cursor.fetchall()]

            cursor.execute(
                """
                select table_name
                from information_schema.views
                where table_schema = 'public'
                  and table_name = 'merchant_daily_metrics'
                """
            )
            views = [row[0] for row in cursor.fetchall()]

            cursor.execute("select count(*) from public.payment_events")
            payment_event_count = cursor.fetchone()[0]

            cursor.execute(
                """
                select count(*), count(distinct email), count(distinct phone_number)
                from public.merchants
                where email is not null and phone_number is not null
                """
            )
            merchants_with_contacts, unique_emails, unique_phone_numbers = cursor.fetchone()

    print("Tables: " + ", ".join(tables))
    print("Views: " + ", ".join(views))
    print(f"Payment events: {payment_event_count}")
    print(
        "Merchant contacts: "
        f"{merchants_with_contacts} complete, {unique_emails} unique emails, "
        f"{unique_phone_numbers} unique phone numbers"
    )


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT / ".tmp" / "db-driver"))
    main()
