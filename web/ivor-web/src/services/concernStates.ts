// Client-side mirror of backend/core/concern_states.py.
//
// Used by the drawer status-select dropdowns in Complaints.tsx + the
// Kiruko compliance ComplianceSection.tsx so the user can ONLY pick
// legal next states from the current state. The backend's state-machine
// validation is still the source of truth (returns HTTP 409 on illegal
// transitions); this mirror just keeps the UI from offering choices that
// would fail on save.
//
// Keep in sync with `backend/core/concern_states.py::ALLOWED_TRANSITIONS`
// + `TRANSITION_ACTORS`. The integration is one-directional: backend is
// authoritative.

export type ConcernStatus =
  | "received"
  | "triaged"
  | "investigating"
  | "action_taken"
  | "resolved"
  | "rejected"
  | "appealed"
  | "closed";

export type ConcernActorKind = "reporter" | "employer" | "kontokaz" | "system";

export const ALL_STATES: readonly ConcernStatus[] = [
  "received",
  "triaged",
  "investigating",
  "action_taken",
  "resolved",
  "rejected",
  "appealed",
  "closed",
] as const;

const ALLOWED_TRANSITIONS: Record<ConcernStatus, readonly ConcernStatus[]> = {
  received: ["triaged", "rejected"],
  triaged: ["investigating", "rejected"],
  investigating: ["action_taken", "rejected"],
  action_taken: ["resolved"],
  resolved: ["appealed", "closed"],
  appealed: ["investigating"],
  rejected: ["appealed", "closed"],
  closed: [], // terminal
};

// Reporter-only transitions. Handlers (employer/kontokaz) cannot drive these.
const REPORTER_ONLY_PAIRS: ReadonlyArray<[ConcernStatus, ConcernStatus]> = [
  ["resolved", "appealed"],
  ["rejected", "appealed"],
];

/**
 * Return the next legal states from `from`, filtered by what the given
 * `actor` is allowed to drive. The current state is included so the
 * dropdown can preselect it without surprising the user.
 */
export function nextStatesFor(
  from: ConcernStatus,
  actor: ConcernActorKind = "employer",
): ConcernStatus[] {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  const visible = allowed.filter((to) => {
    // Reporter-only pairs: handlers cannot select these.
    if (actor !== "reporter") {
      if (REPORTER_ONLY_PAIRS.some(([f, t]) => f === from && t === to)) return false;
    }
    // Reporters cannot drive handler transitions.
    if (actor === "reporter") {
      const isReporterPair = REPORTER_ONLY_PAIRS.some(([f, t]) => f === from && t === to);
      if (!isReporterPair) return false;
    }
    return true;
  });
  // Always include the current state at the top so the select can stay
  // unchanged without forcing a transition.
  return [from, ...visible.filter((s) => s !== from)];
}

export function isTerminal(state: ConcernStatus): boolean {
  return state === "closed";
}
