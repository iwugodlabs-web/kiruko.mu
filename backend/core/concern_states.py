"""Concern (Your Right / dispute) state machine.

Replaces the four-value status string (`pending | in_progress | resolved | rejected`)
with an explicit eight-state workflow plus an actor-aware transition table.

Why a state machine and not free-form strings:
- Legal-defence posture (Kiruko Compliance) requires every status mutation to
  be auditable AND legal under the workflow. A reporter cannot transition a case
  to `closed`; only a handler can. A handler cannot transition a `closed` case
  back to `investigating`; an `appealed` case can.
- Migration 1.C backfills the legacy four states into the new set:
  pending → received, in_progress → investigating, resolved → resolved,
  rejected → rejected. See alembic versions/concern_status_enum_*.

This module is pure Python — no DB session, no FastAPI imports — so it can be
unit-tested in isolation and reused by background scripts (SLA, retention purge).
"""

from __future__ import annotations

from enum import Enum
from typing import Set


class ConcernStatus(str, Enum):
    RECEIVED = "received"
    TRIAGED = "triaged"
    INVESTIGATING = "investigating"
    ACTION_TAKEN = "action_taken"
    RESOLVED = "resolved"
    REJECTED = "rejected"
    APPEALED = "appealed"
    CLOSED = "closed"


class ActorKind(str, Enum):
    REPORTER = "reporter"     # the employee who filed the concern
    EMPLOYER = "employer"     # company HR / Owner / admin handling internal cases
    KONTOKAZ = "kontokaz"     # Kiruko Compliance lawyers handling external cases
    SYSTEM = "system"         # cron jobs, auto-escalation, retention purge


# Allowed (from_state) → {to_state, ...}. Anything not listed is rejected.
ALLOWED_TRANSITIONS: dict[str, Set[str]] = {
    ConcernStatus.RECEIVED.value:      {ConcernStatus.TRIAGED.value, ConcernStatus.REJECTED.value},
    ConcernStatus.TRIAGED.value:       {ConcernStatus.INVESTIGATING.value, ConcernStatus.REJECTED.value},
    ConcernStatus.INVESTIGATING.value: {ConcernStatus.ACTION_TAKEN.value, ConcernStatus.REJECTED.value},
    ConcernStatus.ACTION_TAKEN.value:  {ConcernStatus.RESOLVED.value},
    ConcernStatus.RESOLVED.value:      {ConcernStatus.APPEALED.value, ConcernStatus.CLOSED.value},
    ConcernStatus.APPEALED.value:      {ConcernStatus.INVESTIGATING.value},
    ConcernStatus.REJECTED.value:      {ConcernStatus.APPEALED.value, ConcernStatus.CLOSED.value},
    ConcernStatus.CLOSED.value:        set(),  # terminal
}

# Per-transition actor allow-list. Most transitions are handler-only; appeals
# are reporter-only. If a (from, to) pair is missing here, the transition is
# considered handler-only (employer or kontokaz).
TRANSITION_ACTORS: dict[tuple[str, str], Set[str]] = {
    (ConcernStatus.RESOLVED.value, ConcernStatus.APPEALED.value): {ActorKind.REPORTER.value},
    (ConcernStatus.REJECTED.value, ConcernStatus.APPEALED.value): {ActorKind.REPORTER.value},
}

TERMINAL_STATES: Set[str] = {ConcernStatus.CLOSED.value}


class StateTransitionError(ValueError):
    """Raised when an illegal status transition is attempted.

    HTTP layer maps this to 409 Conflict (not 422) — the caller tried a state
    transition that is well-formed but not legal under the workflow.
    """


def validate_transition(
    from_state: str | None,
    to_state: str,
    actor_kind: str = ActorKind.EMPLOYER.value,
) -> None:
    """Raise StateTransitionError if the transition is illegal.

    Returns None on success so callers can `validate_transition(...); mutate(...)`.

    `from_state=None` is treated as the initial transition into `received`
    (case creation). Any other initial state is rejected.
    """
    if to_state not in {s.value for s in ConcernStatus}:
        raise StateTransitionError(
            f"Unknown target state '{to_state}'. Valid: {sorted(s.value for s in ConcernStatus)}"
        )

    if from_state is None:
        if to_state != ConcernStatus.RECEIVED.value:
            raise StateTransitionError(
                f"New concerns must start in 'received', got '{to_state}'."
            )
        return

    if from_state == to_state:
        # No-op transitions are allowed (idempotent PATCHes); skip the rest.
        return

    if from_state not in ALLOWED_TRANSITIONS:
        raise StateTransitionError(
            f"Unknown source state '{from_state}'. Valid: {sorted(ALLOWED_TRANSITIONS.keys())}"
        )

    allowed = ALLOWED_TRANSITIONS[from_state]
    if to_state not in allowed:
        raise StateTransitionError(
            f"Illegal transition {from_state!r} → {to_state!r}. "
            f"Allowed from {from_state!r}: {sorted(allowed) or '(terminal)'}."
        )

    actors_for_pair = TRANSITION_ACTORS.get((from_state, to_state))
    if actors_for_pair is not None and actor_kind not in actors_for_pair:
        raise StateTransitionError(
            f"Transition {from_state!r} → {to_state!r} requires actor "
            f"in {sorted(actors_for_pair)}, got {actor_kind!r}."
        )

    if actors_for_pair is None and actor_kind == ActorKind.REPORTER.value:
        raise StateTransitionError(
            f"Reporters may not perform transition {from_state!r} → {to_state!r}."
        )


def is_terminal(state: str) -> bool:
    return state in TERMINAL_STATES
