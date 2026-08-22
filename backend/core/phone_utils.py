"""Phone number normalization shared across login + signup + OTP flows.

Started Mauritius-only (8-digit local numbers, +230 country code); extended
for Tanzania (+255, 9-digit local numbers) as the second country onboards.
The canonical form stored against `User.phone` is `+CCNNNNNNNN` (e.g.
`+23057123456`, `+255712345678`).

Why not a 3rd-party lib (phonenumbers)? It pulls 14MB and we only need
~40 lines of logic across two countries today. Revisit if a third country's
numbering plan doesn't fit this simple prefix+length heuristic.
"""

from __future__ import annotations

import re
from typing import List

MU_COUNTRY_CODE = "230"
TZ_COUNTRY_CODE = "255"
# Mauritius mobile + landline local-part is 7 or 8 digits. We accept both
# to be forgiving; if/when the carrier rules tighten we can reject 7-digit
# inputs at signup but still match legacy data on lookup.
_MU_LOCAL_LENGTHS = (7, 8)
# Tanzanian mobile numbers are written locally as 0XXXXXXXXX (10 digits);
# the leading 0 is dropped when prefixed with the country code, leaving a
# 9-digit local part — e.g. 0712 345 678 -> +255712345678.
_TZ_LOCAL_LENGTHS = (9,)
# Ordered so bare local-part matching (no country code, no leading 0) tries
# each country's valid lengths in turn. MU's (7,8) and TZ's (9,) don't
# overlap, so a bare number is unambiguous between these two.
_COUNTRY_LOCAL_LENGTHS = {
    MU_COUNTRY_CODE: _MU_LOCAL_LENGTHS,
    TZ_COUNTRY_CODE: _TZ_LOCAL_LENGTHS,
}


def _digits_only(s: str) -> str:
    return re.sub(r"\D+", "", s or "")


def normalize_phone(raw: str) -> str | None:
    """Return canonical +CCNNNNNNNN form, or None if the input doesn't
    look like a phone number.

    Accepts: "+230 5 712 3456", "00230-57123456", "5712 3456", "+33...".
    Anything < 7 digits is rejected as too-short-to-be-real.
    """
    if not raw:
        return None
    digits = _digits_only(raw)
    if len(digits) < 7:
        return None
    # 00 international prefix → strip to plain country code.
    if digits.startswith("00"):
        digits = digits[2:]
    # If it already starts with a known country code, keep it.
    for cc, local_lengths in _COUNTRY_LOCAL_LENGTHS.items():
        if digits.startswith(cc) and len(digits) - len(cc) in local_lengths:
            return "+" + digits
    # Bare local-part (no country code) → infer from length. MU's and TZ's
    # valid lengths don't overlap, so this is unambiguous between the two.
    # This is also the case for most existing legacy MU rows in the DB.
    for cc, local_lengths in _COUNTRY_LOCAL_LENGTHS.items():
        if len(digits) in local_lengths:
            return "+" + cc + digits
    # Local numbers with a national trunk prefix (e.g. Tanzania's
    # "0712345678", the form printed on a SIM card) don't match any bare
    # length above until the leading 0 is stripped. Only tried as a
    # fallback, after the exact-length match above, so this can't change
    # MU's existing behavior for its own already-valid 7/8-digit lengths.
    if digits.startswith("0") and len(digits) > 1:
        stripped = digits[1:]
        for cc, local_lengths in _COUNTRY_LOCAL_LENGTHS.items():
            if len(stripped) in local_lengths:
                return "+" + cc + stripped
    # Otherwise it has some other country code; keep as-is with `+`.
    return "+" + digits


def lookup_variants(raw: str) -> List[str]:
    """Return the candidate strings that should be matched against
    `User.phone` rows. Existing rows pre-date normalization, so we look up
    against multiple plausible legacy forms in one OR'd query.

    For "+23057123456" returns:
      ['+23057123456', '23057123456', '57123456', '0057123456']
    """
    canonical = normalize_phone(raw)
    if not canonical:
        return []
    variants = {canonical}
    digits = canonical.lstrip("+")
    variants.add(digits)
    # Strip the country code to recover the legacy local-part form.
    for cc in _COUNTRY_LOCAL_LENGTHS:
        if digits.startswith(cc):
            local = digits[len(cc):]
            variants.add(local)
            variants.add("00" + digits)
            break
    return list(variants)


def looks_like_phone(s: str) -> bool:
    """Quick discriminator for login flows that accept either an email or
    a phone in the same field. `@` decisively wins for email; otherwise
    falls through to the digit-count heuristic.
    """
    if not s:
        return False
    if "@" in s:
        return False
    return len(_digits_only(s)) >= 7
