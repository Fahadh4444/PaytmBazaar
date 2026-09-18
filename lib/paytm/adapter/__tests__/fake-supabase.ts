/**
 * Test double for the slice of the Supabase query builder the adapter uses:
 * `from().select()` with `eq`, `in`, `gte`, `lt`, `lte`, `is`, `not(…, "is", …)`,
 * `order`, `range` and `maybeSingle`.
 *
 * It holds rows in memory, mimics PostgREST's server-side row cap
 * (`serverMaxRows`) so pagination can be exercised, and records every request
 * so tests can assert that invalid input never reached the database.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export interface FakeSupabaseOptions {
  /** PostgREST `max-rows`: the most rows any one request returns. */
  serverMaxRows?: number;
  /** Tables whose every request fails with a database error. */
  failingTables?: string[];
}

export interface FakeSupabase {
  client: SupabaseClient;
  /** Table name of every request executed, in order. */
  requests: string[];
}

// Timestamps compare as instants, so "+05:30" and "Z" forms line up as in Postgres.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

function compare(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string" && TIMESTAMP.test(a) && TIMESTAMP.test(b)) {
    return Date.parse(a) - Date.parse(b);
  }
  if (a === b) return 0;
  return (a as string | number) < (b as string | number) ? -1 : 1;
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private readonly predicates: ((row: Row) => boolean)[] = [];
  private readonly orders: string[] = [];
  private columns = "*";
  private window: [number, number] | null = null;
  private single = false;

  constructor(
    private readonly table: string,
    private readonly tables: Record<string, Row[]>,
    private readonly options: FakeSupabaseOptions,
    private readonly requests: string[],
  ) {}

  select(columns = "*") {
    this.columns = columns;
    return this;
  }
  eq(column: string, value: unknown) {
    this.predicates.push((row) => compare(row[column], value) === 0);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.predicates.push((row) => values.some((value) => compare(row[column], value) === 0));
    return this;
  }
  gte(column: string, value: unknown) {
    this.predicates.push((row) => compare(row[column], value) >= 0);
    return this;
  }
  lt(column: string, value: unknown) {
    this.predicates.push((row) => compare(row[column], value) < 0);
    return this;
  }
  lte(column: string, value: unknown) {
    this.predicates.push((row) => compare(row[column], value) <= 0);
    return this;
  }
  is(column: string, value: null) {
    this.predicates.push((row) => row[column] === value);
    return this;
  }
  not(column: string, operator: "is", value: null) {
    this.predicates.push((row) => row[column] !== value);
    return this;
  }
  order(column: string) {
    this.orders.push(column);
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): { data: unknown; error: unknown } {
    this.requests.push(this.table);

    if (this.options.failingTables?.includes(this.table)) {
      return {
        data: null,
        error: { message: "connection reset", code: "08006", details: "", hint: "" },
      };
    }

    let rows = (this.tables[this.table] ?? []).filter((row) => this.predicates.every((p) => p(row)));
    rows = [...rows].sort((a, b) => {
      for (const column of this.orders) {
        const order = compare(a[column], b[column]);
        if (order !== 0) return order;
      }
      return 0;
    });

    if (this.single) {
      if (rows.length > 1) return { data: null, error: { message: "multiple rows", code: "PGRST116" } };
      return { data: rows[0] ? { ...rows[0] } : null, error: null };
    }

    const [from, to] = this.window ?? [0, Number.MAX_SAFE_INTEGER];
    const cap = this.options.serverMaxRows ?? 1000;
    rows = rows.slice(from, Math.min(to, from + cap - 1) + 1);

    const picked = this.columns === "*" ? null : this.columns.split(",").map((c) => c.trim());
    return {
      data: rows.map((row) =>
        picked ? Object.fromEntries(picked.map((column) => [column, row[column]])) : { ...row },
      ),
      error: null,
    };
  }
}

export function createFakeSupabase(
  tables: Record<string, Row[]>,
  options: FakeSupabaseOptions = {},
): FakeSupabase {
  const requests: string[] = [];
  const client = {
    from: (table: string) => new FakeQuery(table, tables, options, requests),
  };
  return { client: client as unknown as SupabaseClient, requests };
}
