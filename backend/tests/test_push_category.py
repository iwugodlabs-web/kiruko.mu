"""One-tap clock-out push category — payload contract tests.

The clock-out reminder carries ``categoryId: "clock-out"`` so the app can
offer a Clock out action button; every other notification omits it
(backward compatible). Uses unittest.mock — no network, no DB.
"""

from unittest.mock import patch


class _Resp:
    def raise_for_status(self):
        return None


def _sent_body():
    with patch("services.notification_service.requests.post") as mock_post:
        mock_post.return_value = _Resp()
        from services.notification_service import NotificationService

        yield NotificationService, mock_post


def test_clock_out_category_included():
    gen = _sent_body()
    NotificationService, mock_post = next(gen)
    assert NotificationService.send_expo_push(
        "tok", "t", "b", {"type": "clock_reminder", "kind": "clock_out"},
        category_id="clock-out",
    ) is True
    payload = mock_post.call_args.kwargs["json"]
    assert payload["categoryId"] == "clock-out"
    assert payload["data"]["kind"] == "clock_out"


def test_category_omitted_by_default():
    gen = _sent_body()
    NotificationService, mock_post = next(gen)
    assert NotificationService.send_expo_push("tok", "t", "b") is True
    payload = mock_post.call_args.kwargs["json"]
    assert "categoryId" not in payload


def test_empty_token_short_circuits():
    from services.notification_service import NotificationService

    with patch("services.notification_service.requests.post") as mock_post:
        assert NotificationService.send_expo_push("", "t", "b") is False
        mock_post.assert_not_called()
