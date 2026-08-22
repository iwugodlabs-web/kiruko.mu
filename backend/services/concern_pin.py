"""Reporter-portal PIN issuance + verification.

A reporter who files a concern receives an 8-character alphanumeric PIN at
submission. The plaintext PIN is shown to the reporter ONCE in the API
response (POST /user/user-right) and never stored — only its bcrypt hash
goes into `user_rights.case_pin_hash`. To return to the case via the
public reporter portal (`/portal/concerns/lookup`), the reporter supplies
case_id + PIN; the server verifies against the hash.

Lookalike characters (`0`, `O`, `1`, `I`, `l`) are excluded from the
alphabet to reduce reporter error when reading the PIN off a PDF.

Reuses the project's existing bcrypt config from `core.security`
(`passwd_context`) so PIN hashing follows the same cost factor / future
upgrades as user passwords.
"""

from __future__ import annotations

import secrets
from typing import Final

from core.security import passwd_context

# Alphabet excludes 0, O, 1, I, l. 32 chars × 8 positions ≈ 1.1 trillion
# combinations — well above brute-force reach when paired with the rate
# limits in `concern_portal_security`.
_PIN_ALPHABET: Final[str] = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
PIN_LENGTH: Final[int] = 8


def generate() -> str:
    """Generate a fresh PIN. Uses `secrets` (crypto-grade RNG)."""
    return "".join(secrets.choice(_PIN_ALPHABET) for _ in range(PIN_LENGTH))


def hash_pin(plaintext: str) -> str:
    """Return a bcrypt hash of `plaintext`. Cost factor inherits passwd_context."""
    return passwd_context.hash(plaintext)


def verify(plaintext: str, hashed: str) -> bool:
    """Constant-time verify a PIN against a stored bcrypt hash.

    Returns False on any error (malformed hash, empty inputs, etc.) — never
    raises. The portal must always return the same 401 payload regardless of
    whether the case_id existed or the PIN was wrong; raising here would let
    the caller distinguish those cases via timing or stack-trace leakage.
    """
    if not plaintext or not hashed:
        return False
    try:
        return passwd_context.verify(plaintext, hashed)
    except Exception:
        return False


def normalize(user_input: str) -> str:
    """Strip whitespace and uppercase. Reporters often type the PIN with
    spaces or in lowercase; meet them where they are.

    Does NOT translate lookalike characters because the alphabet excludes
    them — translating `O→0` would silently corrupt a legitimate PIN that
    happened to contain `O`. Just normalize case and strip surrounds.
    """
    return (user_input or "").strip().replace(" ", "").upper()
