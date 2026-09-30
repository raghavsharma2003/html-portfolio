// Every primary mutation and intent capture uses the same owner-scoped replica
// row lock, after any source lock. Never wait and reuse a stale statement view.
export async function primarySelectionQuery(db, sql, params) {
  try {
    const rows = await db(sql, params);
    if (rows[0]?.primary_selection_snapshot_stale === true) {
      throw Object.assign(new Error("primary_voice_selection_busy"), { code: "55P03" });
    }
    return Array.isArray(rows[0]?.primary_selection_rows) ? rows[0].primary_selection_rows : rows;
  } catch (error) {
    if (error?.code !== "55P03") throw error;
    throw Object.assign(new Error("primary_voice_selection_busy"), {
      code: "primary_voice_selection_busy", status: 409, retryable: true, cause: error,
    });
  }
}
