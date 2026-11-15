"""End-of-interview reports retry on a busy or waking web app, not on a refusal."""

import asyncio

import httpx
import pytest

from intervia_agent import backend as backend_module
from intervia_agent.backend import Backend


def _backend(statuses: list[int]) -> tuple[Backend, list[int]]:
    seen: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        status = statuses[min(len(seen), len(statuses) - 1)]
        seen.append(status)
        return httpx.Response(status, json={})

    b = Backend("http://web.test", "s", "room1")
    b._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return b, seen


@pytest.fixture(autouse=True)
def _no_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backend_module, "REPORT_BACKOFF_SECONDS", (0.0, 0.0))


def test_a_5xx_is_retried_until_it_succeeds() -> None:
    b, seen = _backend([503, 500, 200])
    asyncio.run(b._post_with_retries("http://web.test/complete", json={}))
    assert seen == [503, 500, 200]


def test_a_refusal_is_not_repeated() -> None:
    b, seen = _backend([400, 200])
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(b._post_with_retries("http://web.test/complete", json={}))
    assert seen == [400]


def test_it_gives_up_after_three_tries() -> None:
    b, seen = _backend([502])
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(b._post_with_retries("http://web.test/complete", json={}))
    assert seen == [502, 502, 502]
