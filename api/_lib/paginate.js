// Paginates any Supabase query around the platform's default 1000-row cap. `orderCol`
// must be a column guaranteed unique per row (part of a primary key — `hash` for
// sales_log/call_log, `id` for bonus_activities) so page boundaries are stable: an
// unordered multi-page fetch can otherwise return a duplicate row on two pages or skip one
// entirely, corrupting whatever aggregate is computed from the result.
//
// This exact mistake — an unpaginated `.select()` on sales_log/call_log/bonus_activities —
// independently recurred in at least 6 different files before this shared helper existed
// (upload.js, api/ai-analysis.js, api/agent-goals.js, api/sales.js, each found and fixed
// separately on its own reported symptom). See CLAUDE.md "Pagination bug" for the full
// incident history. New code querying any of these three tables should use this helper
// rather than adding another ad-hoc copy of the loop.
//
// `buildQuery(q)` receives a fresh `supabase.from(table)` builder per page and must return
// it with `.select()`/`.eq()`/etc. already applied — this helper appends the order/range.
export async function fetchAllRows(supabase, table, orderCol, buildQuery) {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(supabase.from(table))
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    if (data?.length) rows.push(...data);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}
