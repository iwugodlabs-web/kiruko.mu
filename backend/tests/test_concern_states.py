"""Unit tests for the concern state machine.

Pure-logic tests — no DB, no fixtures. Covers every legal transition + a sample
of the most likely illegal ones (skipping states, reporter-only transitions,
unknown states, terminal-state guards).
"""

import pytest

from core.concern_states import (
    ALLOWED_TRANSITIONS,
    ActorKind,
    ConcernStatus,
    StateTransitionError,
    TERMINAL_STATES,
    is_terminal,
    validate_transition,
)


class TestLegalTransitions:
    """Every entry in ALLOWED_TRANSITIONS must validate cleanly."""

    @pytest.mark.parametrize("from_state,to_state", [
        (from_state, to_state)
        for from_state, allowed in ALLOWED_TRANSITIONS.items()
        for to_state in allowed
    ])
    def test_handler_legal_transitions_pass(self, from_state, to_state):
        # Reporter-only transitions are tested separately
        if to_state == ConcernStatus.APPEALED.value:
            return
        validate_transition(from_state, to_state, ActorKind.EMPLOYER.value)
        validate_transition(from_state, to_state, ActorKind.KONTOKAZ.value)

    def test_initial_transition_to_received_succeeds(self):
        validate_transition(None, ConcernStatus.RECEIVED.value)

    def test_idempotent_same_state_is_allowed(self):
        # PATCHing status to its current value should be a no-op, not a 409
        for state in (s.value for s in ConcernStatus):
            validate_transition(state, state)


class TestIllegalTransitions:
    def test_initial_transition_to_anything_other_than_received_fails(self):
        with pytest.raises(StateTransitionError):
            validate_transition(None, ConcernStatus.INVESTIGATING.value)

    def test_skipping_states_fails(self):
        # Cannot jump received → investigating without going through triaged
        with pytest.raises(StateTransitionError):
            validate_transition(
                ConcernStatus.RECEIVED.value,
                ConcernStatus.INVESTIGATING.value,
            )
        with pytest.raises(StateTransitionError):
            validate_transition(
                ConcernStatus.RECEIVED.value,
                ConcernStatus.RESOLVED.value,
            )

    def test_closed_is_terminal(self):
        assert is_terminal(ConcernStatus.CLOSED.value)
        assert ALLOWED_TRANSITIONS[ConcernStatus.CLOSED.value] == set()
        with pytest.raises(StateTransitionError):
            validate_transition(
                ConcernStatus.CLOSED.value,
                ConcernStatus.INVESTIGATING.value,
            )

    def test_unknown_target_state_fails(self):
        with pytest.raises(StateTransitionError):
            validate_transition(
                ConcernStatus.RECEIVED.value,
                "spaghetti",
            )

    def test_unknown_source_state_fails(self):
        with pytest.raises(StateTransitionError):
            validate_transition(
                "spaghetti",
                ConcernStatus.RECEIVED.value,
            )

    def test_action_taken_can_only_resolve(self):
        # action_taken → anything other than resolved is illegal
        for to_state in (s.value for s in ConcernStatus):
            if to_state in (ConcernStatus.ACTION_TAKEN.value, ConcernStatus.RESOLVED.value):
                continue
            with pytest.raises(StateTransitionError):
                validate_transition(
                    ConcernStatus.ACTION_TAKEN.value,
                    to_state,
                )

    def test_appealed_can_only_go_back_to_investigating(self):
        for to_state in (s.value for s in ConcernStatus):
            if to_state in (ConcernStatus.APPEALED.value, ConcernStatus.INVESTIGATING.value):
                continue
            with pytest.raises(StateTransitionError):
                validate_transition(
                    ConcernStatus.APPEALED.value,
                    to_state,
                )


class TestActorEnforcement:
    def test_reporter_can_appeal_resolved(self):
        validate_transition(
            ConcernStatus.RESOLVED.value,
            ConcernStatus.APPEALED.value,
            ActorKind.REPORTER.value,
        )

    def test_reporter_can_appeal_rejected(self):
        validate_transition(
            ConcernStatus.REJECTED.value,
            ConcernStatus.APPEALED.value,
            ActorKind.REPORTER.value,
        )

    def test_employer_cannot_appeal(self):
        # Appeals are a reporter prerogative; an employer flipping a case to
        # appealed would be policy laundering.
        with pytest.raises(StateTransitionError):
            validate_transition(
                ConcernStatus.RESOLVED.value,
                ConcernStatus.APPEALED.value,
                ActorKind.EMPLOYER.value,
            )

    def test_reporter_cannot_close(self):
        with pytest.raises(StateTransitionError):
            validate_transition(
                ConcernStatus.RESOLVED.value,
                ConcernStatus.CLOSED.value,
                ActorKind.REPORTER.value,
            )

    def test_reporter_cannot_progress_workflow(self):
        # Reporters must not drive triage / investigation / etc.
        with pytest.raises(StateTransitionError):
            validate_transition(
                ConcernStatus.RECEIVED.value,
                ConcernStatus.TRIAGED.value,
                ActorKind.REPORTER.value,
            )
        with pytest.raises(StateTransitionError):
            validate_transition(
                ConcernStatus.TRIAGED.value,
                ConcernStatus.INVESTIGATING.value,
                ActorKind.REPORTER.value,
            )

    def test_kontokaz_can_progress_external_workflow(self):
        # Sanity check: Kiruko handlers behave like employer handlers for
        # the workflow transitions, just on external cases.
        validate_transition(
            ConcernStatus.RECEIVED.value,
            ConcernStatus.TRIAGED.value,
            ActorKind.KONTOKAZ.value,
        )
        validate_transition(
            ConcernStatus.INVESTIGATING.value,
            ConcernStatus.ACTION_TAKEN.value,
            ActorKind.KONTOKAZ.value,
        )


class TestTerminalSet:
    def test_only_closed_is_terminal(self):
        assert TERMINAL_STATES == {ConcernStatus.CLOSED.value}
        assert is_terminal(ConcernStatus.CLOSED.value) is True
        assert is_terminal(ConcernStatus.RESOLVED.value) is False
