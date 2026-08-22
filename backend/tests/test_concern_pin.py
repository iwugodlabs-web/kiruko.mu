"""Unit tests for the reporter-portal PIN service."""

import pytest

from services import concern_pin


class TestGenerate:
    def test_pin_is_8_chars(self):
        for _ in range(50):
            assert len(concern_pin.generate()) == concern_pin.PIN_LENGTH == 8

    def test_pin_excludes_lookalike_chars(self):
        forbidden = set("0O1Il")
        for _ in range(100):
            pin = concern_pin.generate()
            assert not (set(pin) & forbidden), f"PIN {pin} contains a lookalike"

    def test_pin_is_uppercase_alphanumeric(self):
        for _ in range(50):
            pin = concern_pin.generate()
            assert pin.isascii()
            for ch in pin:
                assert ch.isdigit() or (ch.isalpha() and ch.isupper())

    def test_consecutive_pins_differ(self):
        # Sanity: 50 generations should not all collide. Probability of even
        # one collision is astronomically low across 32^8.
        pins = {concern_pin.generate() for _ in range(50)}
        assert len(pins) == 50


class TestHashAndVerify:
    def test_correct_pin_verifies(self):
        pin = concern_pin.generate()
        h = concern_pin.hash_pin(pin)
        assert concern_pin.verify(pin, h) is True

    def test_wrong_pin_fails(self):
        pin = concern_pin.generate()
        h = concern_pin.hash_pin(pin)
        # Generate a different PIN — astronomically unlikely to collide
        wrong = concern_pin.generate()
        if wrong == pin:
            wrong = concern_pin.generate()
        assert concern_pin.verify(wrong, h) is False

    def test_empty_inputs_return_false_not_raise(self):
        assert concern_pin.verify("", "x") is False
        assert concern_pin.verify("X", "") is False
        assert concern_pin.verify("", "") is False

    def test_malformed_hash_returns_false_not_raise(self):
        # passlib will throw on totally bogus input; we must catch.
        assert concern_pin.verify("ABCDEFGH", "not-a-bcrypt-hash") is False

    def test_hash_is_not_plaintext(self):
        pin = "TESTPIN1"
        h = concern_pin.hash_pin(pin)
        assert pin not in h

    def test_two_hashes_of_same_pin_differ(self):
        # bcrypt salts each hash; two hashes of the same PIN should differ
        pin = "ABCDEFGH"
        assert concern_pin.hash_pin(pin) != concern_pin.hash_pin(pin)


class TestNormalize:
    @pytest.mark.parametrize("raw,expected", [
        ("ABCD1234", "ABCD1234"),
        ("abcd1234", "ABCD1234"),
        ("  ABCD1234  ", "ABCD1234"),
        ("AB CD 12 34", "ABCD1234"),
        ("ab cd 12 34", "ABCD1234"),
        ("", ""),
    ])
    def test_normalize(self, raw, expected):
        assert concern_pin.normalize(raw) == expected

    def test_normalize_does_not_translate_lookalikes(self):
        # "O" must NOT become "0" — that would corrupt a legitimate PIN that
        # included "O" in its alphabet (we exclude O from generation, but a
        # malicious caller could still POST it; we treat it as a wrong PIN
        # rather than silently translating).
        assert concern_pin.normalize("OOOO0000") == "OOOO0000"
