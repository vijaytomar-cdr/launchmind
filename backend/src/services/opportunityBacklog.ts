/**
 * @file opportunityBacklog.ts
 * @description THE single definition of "the owner's current opportunity backlog".
 *
 *   THE DEFECT THIS EXISTS TO PREVENT:
 *     The sidebar badge and the Opportunities page each carried their own idea of
 *     which rows count, written months apart and never compared:
 *
 *       badge  (GET /owner/counts)        .in('state', ['active', 'saved'])
 *       page   (GET /owner/opportunities) .not('state', 'eq', 'dismissed')
 *
 *     Those agree only while no row is `converted`. The moment an owner turns an
 *     opportunity into a mission the page keeps listing it (it renders a
 *     "converted" treatment on purpose) while the badge silently drops it. The
 *     badge then under-reports for as long as that row exists, and nothing in
 *     either file hints that the other one disagrees.
 *
 *   THE RULE:
 *     The badge is a promise about what the owner will find when they click it.
 *     It must therefore count exactly the population the destination lists — not
 *     an approximation of it. Both call sites now go through applyBacklogFilter,
 *     so the two can only diverge if someone edits this file, which is the one
 *     place where changing the meaning is a deliberate act.
 *
 *   TRADE-OFF ACCEPTED: a `converted` opportunity keeps counting toward the badge
 *   until it is dismissed, because the page still lists it. Counting it as gone
 *   while the owner can still see it sitting there is the worse of the two lies.
 *
 * @security No authorization here. The ACTIVE BUSINESS is resolved by the caller
 *   and passed in as an already-verified product id; this module only ever adds a
 *   state predicate on top of that scoping. It must never widen a query.
 * @dependencies none (operates on a PostgREST query builder)
 */

/**
 * States hidden from the backlog.
 *
 * Dismissed is the owner explicitly saying "not this" — the one state that means
 * "stop showing me this". Everything else is still live backlog.
 */
export const BACKLOG_HIDDEN_STATES = ['dismissed'] as const;

/** Minimal shape of the PostgREST builder methods used here. */
interface StateFilterable<T> {
  not(column: string, operator: string, value: unknown): T;
}

/**
 * Restricts a `saved_opportunities` query to the owner's current backlog.
 *
 * Applied by BOTH the sidebar count and the Opportunities "All" list so the two
 * cannot describe different populations.
 *
 * @param query - A saved_opportunities query ALREADY scoped to the active product
 * @returns The same builder with the backlog state predicate applied
 * @security Only ever narrows. Callers remain responsible for product scoping.
 */
export function applyBacklogFilter<T extends StateFilterable<T>>(query: T): T {
  // Single hidden state today, but expressed as a fold so adding another one
  // here updates the badge and the page in the same edit.
  return BACKLOG_HIDDEN_STATES.reduce<T>(
    (q, state) => q.not('state', 'eq', state),
    query,
  );
}

/**
 * Whether a row belongs to the backlog, for in-memory checks and tests.
 *
 * Kept in this file, next to the query predicate, so the two definitions are read
 * and changed together.
 */
export function isBacklogState(state: string | null | undefined): boolean {
  if (!state) return false;
  return !(BACKLOG_HIDDEN_STATES as readonly string[]).includes(state);
}
