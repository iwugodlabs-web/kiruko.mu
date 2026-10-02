/**
 * Shared employee search matcher for the review + attendance screens.
 *
 * Matches a time-log row by employee name (case-insensitive substring),
 * employee code, or numeric private-user id. Empty/blank queries match
 * everything so callers can apply it unconditionally. Never throws —
 * a malformed row simply doesn't match a non-empty query.
 */
export interface EmployeeIdentifiable {
  employee_name?: string | null;
  employee_code?: string | null;
  private_user_id?: number | string | null;
}

export function matchesEmployeeQuery<T extends EmployeeIdentifiable>(
  log: T | null | undefined,
  query: string | null | undefined,
): boolean {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  if (!log) return false;
  if (log.employee_name && log.employee_name.toLowerCase().includes(q)) return true;
  if (log.employee_code && log.employee_code.toLowerCase().includes(q)) return true;
  if (log.private_user_id != null && String(log.private_user_id) === q) return true;
  return false;
}

/** Directory entry (employee dropdown source). Code is optional — not all
 * directory responses carry one; name + id always match. */
export interface DirectoryEmployee {
  name?: string | null;
  employee_code?: string | null;
  private_user_id?: number | string | null;
}

/** Ranked directory matches for an autocomplete: exact id/code first, then
 * name substring. Empty query returns []. Caller slices to display size. */
export function searchDirectory<T extends DirectoryEmployee>(
  list: readonly T[] | null | undefined,
  query: string | null | undefined,
): T[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q || !list) return [];
  const exact: T[] = [];
  const partial: T[] = [];
  for (const e of list) {
    if (e.private_user_id != null && String(e.private_user_id) === q) {
      exact.push(e);
      continue;
    }
    if (e.employee_code && e.employee_code.toLowerCase() === q) {
      exact.push(e);
      continue;
    }
    if (
      (e.name && e.name.toLowerCase().includes(q)) ||
      (e.employee_code && e.employee_code.toLowerCase().includes(q))
    ) {
      partial.push(e);
    }
  }
  return [...exact, ...partial];
}
