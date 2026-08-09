/**
 * @file memoryDb.ts
 * @description Minimal in-memory stand-in for the Supabase query builder that
 *   HONOURS filter predicates.
 *
 *   Why this exists: the previous connection tests used a chain stub whose .eq()
 *   returned `this` and ignored the argument. Under that stub a tenant-isolation
 *   test passes even if the service forgets its workspace predicate entirely — it
 *   proves nothing. This stub actually filters, so a missing
 *   `.eq('workspace_id', …)` shows up as cross-tenant data in the result.
 *
 *   Supported: select/insert/update/upsert/delete, eq/neq/in/is/not/lt/gt/gte/lte,
 *   order/limit/range, single/maybeSingle, head+count, and thenable array resolution.
 *
 * @security Test-only. Never imported by src/.
 */

import { randomUUID } from 'crypto';

type Row = Record<string, unknown>;

interface Filter {
  op: 'eq' | 'neq' | 'in' | 'is' | 'not-is' | 'lt' | 'gt' | 'gte' | 'lte';
  column: string;
  value: unknown;
}

/** Applies one filter to a row. */
function matches(row: Row, f: Filter): boolean {
  const actual = row[f.column];
  switch (f.op) {
    case 'eq':     return actual === f.value;
    case 'neq':    return actual !== f.value;
    case 'in':     return Array.isArray(f.value) && (f.value as unknown[]).includes(actual);
    case 'is':     return f.value === null ? actual === null || actual === undefined : actual === f.value;
    case 'not-is': return f.value === null ? actual !== null && actual !== undefined : actual !== f.value;
    case 'lt':     return (actual as never) < (f.value as never);
    case 'gt':     return (actual as never) > (f.value as never);
    case 'gte':    return (actual as never) >= (f.value as never);
    case 'lte':    return (actual as never) <= (f.value as never);
    default:       return true;
  }
}

/** An in-memory database keyed by table name. */
export class MemoryDb {
  private tables = new Map<string, Row[]>();
  /** Every table touched, for assertions about which tables a code path reads. */
  readonly touched: string[] = [];

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [table, rows] of Object.entries(seed)) {
      this.tables.set(table, rows.map(r => ({ ...r })));
    }
  }

  /** Returns a copy of a table's rows. */
  rows(table: string): Row[] {
    return (this.tables.get(table) ?? []).map(r => ({ ...r }));
  }

  /** Replaces a table's contents. */
  setRows(table: string, rows: Row[]): void {
    this.tables.set(table, rows.map(r => ({ ...r })));
  }

  /** Live array, used internally by the query builder. */
  private live(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table) as Row[];
  }

  /** Supabase-like `.from(table)` entry point. */
  from(table: string): QueryBuilder {
    this.touched.push(table);
    return new QueryBuilder(this.live(table), table);
  }

  /** Object shaped like the supabaseAdmin client, for vi.mock factories. */
  asClient(authUserResolver?: (token: string) => { id: string }) {
    return {
      from: (table: string) => this.from(table),
      auth: {
        getUser: async (token: string) => {
          const user = authUserResolver
            ? authUserResolver(token)
            : { id: decodeJwtSub(token) ?? 'unknown' };
          return { data: { user: { id: user.id, email: `${user.id}@example.test` } }, error: null };
        },
      },
    };
  }
}

/** Decodes the `sub` claim from a JWT without verifying it. Test helper only. */
export function decodeJwtSub(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from((token ?? '').split('.')[1] ?? '', 'base64url').toString('utf-8'),
    );
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

class QueryBuilder implements PromiseLike<{ data: Row[] | null; error: null; count: number | null }> {
  private filters: Filter[] = [];
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: Row[] = [];
  private orderBy: Array<{ column: string; ascending: boolean }> = [];
  private limitN: number | null = null;
  private wantCount = false;
  private headOnly = false;

  constructor(private store: Row[], private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (this.mode === 'select') this.mode = 'select';
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  insert(values: Row | Row[]): this {
    this.mode = 'insert';
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  update(values: Row): this {
    this.mode = 'update';
    this.payload = [values];
    return this;
  }

  upsert(values: Row | Row[], _opts?: unknown): this {
    this.mode = 'upsert';
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  delete(): this {
    this.mode = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this  { this.filters.push({ op: 'eq', column, value }); return this; }
  neq(column: string, value: unknown): this { this.filters.push({ op: 'neq', column, value }); return this; }
  in(column: string, value: unknown[]): this { this.filters.push({ op: 'in', column, value }); return this; }
  is(column: string, value: unknown): this  { this.filters.push({ op: 'is', column, value }); return this; }
  lt(column: string, value: unknown): this  { this.filters.push({ op: 'lt', column, value }); return this; }
  gt(column: string, value: unknown): this  { this.filters.push({ op: 'gt', column, value }); return this; }
  gte(column: string, value: unknown): this { this.filters.push({ op: 'gte', column, value }); return this; }
  lte(column: string, value: unknown): this { this.filters.push({ op: 'lte', column, value }); return this; }

  /** Supports the `.not('col', 'is', null)` form used for accepted_at checks. */
  not(column: string, op: string, value: unknown): this {
    if (op === 'is') this.filters.push({ op: 'not-is', column, value });
    else this.filters.push({ op: 'neq', column, value });
    return this;
  }

  /**
   * Accumulates ordering clauses. PostgREST applies chained .order() calls in the
   * order they were made; keeping only the last one hid a real tie-break bug in
   * connection_insights, where rows written by one sync share a created_at.
   */
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push({ column, ascending: opts?.ascending !== false });
    return this;
  }

  limit(n: number): this { this.limitN = n; return this; }
  range(): this { return this; }
  head(): this { this.headOnly = true; return this; }

  private filtered(): Row[] {
    return this.store.filter(row => this.filters.every(f => matches(row, f)));
  }

  /** Applies the pending mutation and returns the affected rows. */
  private execute(): Row[] {
    if (this.mode === 'insert' || this.mode === 'upsert') {
      const created = this.payload.map(v => ({
        // Real UUIDs: routes validate id shape before dispatching, so a synthetic
        // id like `gen_table_1` would be rejected with 400 and mask real behaviour.
        id: (v.id as string) ?? randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...v,
      }));
      this.store.push(...created);
      return created;
    }

    if (this.mode === 'update') {
      const target = this.filtered();
      for (const row of target) {
        const idx = this.store.indexOf(row);
        if (idx >= 0) this.store[idx] = { ...row, ...this.payload[0] };
      }
      // Return post-update copies.
      return this.store.filter(row => this.filters.every(f => matches({ ...row, ...{} }, f)) ||
        target.some(t => t.id === row.id));
    }

    if (this.mode === 'delete') {
      const target = this.filtered();
      for (const row of target) {
        const idx = this.store.indexOf(row);
        if (idx >= 0) this.store.splice(idx, 1);
      }
      return target;
    }

    let rows = this.filtered();
    if (this.orderBy.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const { column, ascending } of this.orderBy) {
          const av = a[column];
          const bv = b[column];
          // Numeric columns (confidence, progress) must compare numerically —
          // string comparison would order 9 after 10.
          const cmp = typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av ?? '').localeCompare(String(bv ?? ''));
          if (cmp !== 0) return ascending ? cmp : -cmp;
        }
        return 0;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  /**
   * For UPDATE the post-mutation read must re-apply only the identity filters,
   * because the compare-and-set predicate (e.g. status) no longer matches.
   */
  private resultRows(): Row[] {
    if (this.mode !== 'update') return this.execute();

    const idFilters = this.filters.filter(f => f.column === 'id' || f.column === 'workspace_id' || f.column === 'founder_id');
    const target = this.store.filter(row => this.filters.every(f => matches(row, f)));
    const ids = new Set(target.map(r => r.id));

    for (const row of target) {
      const idx = this.store.indexOf(row);
      if (idx >= 0) this.store[idx] = { ...row, ...this.payload[0] };
    }

    return this.store.filter(row => ids.has(row.id) && idFilters.every(f => matches(row, f)));
  }

  async single(): Promise<{ data: Row | null; error: { message: string; code: string } | null }> {
    const rows = this.resultRows();
    if (rows.length === 0) {
      return { data: null, error: { message: 'No rows returned', code: 'PGRST116' } };
    }
    return { data: { ...rows[0] }, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const rows = this.resultRows();
    return { data: rows.length > 0 ? { ...rows[0] } : null, error: null };
  }

  then<TResult1 = { data: Row[] | null; error: null; count: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: null; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let rows: Row[];
    try {
      rows = this.resultRows();
    } catch (err) {
      return Promise.reject(err).then(onfulfilled as never, onrejected as never);
    }
    const value = {
      data:  this.headOnly ? null : rows.map(r => ({ ...r })),
      error: null as null,
      count: this.wantCount ? rows.length : null,
    };
    return Promise.resolve(value).then(onfulfilled as never, onrejected as never);
  }
}
