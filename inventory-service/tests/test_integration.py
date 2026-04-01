"""
Integration flow tests for the Inventory Service.

These tests run full multi-step scenarios through the FastAPI ASGI app
(via TestClient) with a fully mocked engine and Redis, validating
end-to-end request flows rather than individual endpoint behaviour.
"""
from __future__ import annotations

import sys
import os
import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ─── Shared fixture ───────────────────────────────────────────────────────────

def _make_item(stock: int = 10) -> MagicMock:
    item = MagicMock()
    item.id = uuid.uuid4()
    item.restaurant_id = uuid.uuid4()
    item.name = "Burger"
    item.description = "Juicy"
    item.price = 12.99
    item.stock_quantity = stock
    item.is_unlimited = stock == -1
    item.available = stock > 0 or stock == -1
    return item


@pytest.fixture()
def app_client():
    """TestClient with mocked DB session, engine, and Redis."""
    import main  # noqa: PLC0415

    session = AsyncMock()
    session.commit = AsyncMock()

    mock_conn = AsyncMock()
    mock_conn.run_sync = AsyncMock()

    @asynccontextmanager
    async def _mock_begin():
        yield mock_conn

    mock_engine = MagicMock()
    mock_engine.begin = _mock_begin
    mock_engine.dispose = AsyncMock()

    mock_redis = AsyncMock()
    mock_redis.set = AsyncMock(return_value=True)  # lock always acquired
    mock_redis.delete = AsyncMock()
    mock_redis.aclose = AsyncMock()

    async def _override_db():
        yield session

    main.app.dependency_overrides[main.get_db] = _override_db

    with patch("main.engine", mock_engine), \
         patch("main.aioredis.from_url", return_value=mock_redis):
        with TestClient(main.app) as c:
            c._session = session       # type: ignore[attr-defined]
            c._redis = mock_redis      # type: ignore[attr-defined]
            yield c

    main.app.dependency_overrides.clear()


# ─── Flow: reserve → check stock → release ────────────────────────────────────

def test_flow_reserve_then_release(app_client):
    """
    Full cycle: reserve 3 units, verify remaining, release 2, verify restored.
    """
    import main  # noqa: PLC0415

    item = _make_item(stock=10)
    app_client._session.get.return_value = item
    main.redis_client = app_client._redis  # type: ignore[attr-defined]

    # Reserve 3 units
    resp = app_client.post(f"/menu-items/{item.id}/reserve", json={"quantity": 3})
    assert resp.status_code == 200
    assert resp.json()["reserved"] is True
    assert resp.json()["remaining"] == 7

    # Update mock item to reflect new stock
    item.stock_quantity = 7
    item.is_unlimited = False

    # Release 2 units
    resp = app_client.post(f"/menu-items/{item.id}/release", json={"quantity": 2})
    assert resp.status_code == 200
    assert resp.json()["released"] is True
    assert resp.json()["remaining"] == 9


def test_flow_exhaust_stock_then_reject(app_client):
    """
    Reserve all stock → next reservation must fail with 409.
    """
    import main  # noqa: PLC0415

    item = _make_item(stock=5)
    app_client._session.get.return_value = item
    main.redis_client = app_client._redis  # type: ignore[attr-defined]

    # Reserve all 5
    resp = app_client.post(f"/menu-items/{item.id}/reserve", json={"quantity": 5})
    assert resp.status_code == 200
    assert resp.json()["remaining"] == 0

    # Stock now depleted
    item.stock_quantity = 0

    # Next reservation must fail
    resp = app_client.post(f"/menu-items/{item.id}/reserve", json={"quantity": 1})
    assert resp.status_code == 409
    assert "insufficient" in resp.json()["detail"].lower()


def test_flow_unlimited_item_never_exhausted(app_client):
    """
    stock_quantity == -1 items always reserve successfully regardless of quantity.
    """
    item = _make_item(stock=-1)
    app_client._session.get.return_value = item

    for qty in [1, 100, 9999]:
        resp = app_client.post(f"/menu-items/{item.id}/reserve", json={"quantity": qty})
        assert resp.status_code == 200
        assert resp.json()["remaining"] == -1


def test_flow_restaurant_then_menu(app_client):
    """
    Fetch a restaurant, then fetch its menu — both calls succeed
    and share the same restaurant_id.
    """
    restaurant = MagicMock()
    restaurant.id = uuid.uuid4()
    restaurant.name = "Test Bistro"
    restaurant.address = "1 Main St"
    restaurant.phone = "+1-555-0000"
    restaurant.cuisine_type = "Italian"
    restaurant.rating = 4.8
    restaurant.open_now = True

    item1 = _make_item(stock=20)
    item1.restaurant_id = restaurant.id
    item2 = _make_item(stock=-1)
    item2.restaurant_id = restaurant.id

    # GET /restaurants/{id}
    app_client._session.get.return_value = restaurant
    resp = app_client.get(f"/restaurants/{restaurant.id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Test Bistro"

    # GET /restaurants/{id}/menu
    result = MagicMock()
    result.scalars.return_value.all.return_value = [item1, item2]
    app_client._session.execute.return_value = result
    resp = app_client.get(f"/restaurants/{restaurant.id}/menu")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 2
    stocks = {i["stock_quantity"] for i in items}
    assert stocks == {20, -1}


def test_flow_partial_reserve_on_exact_boundary(app_client):
    """
    Reserve exactly the available quantity — succeeds with 0 remaining.
    Then one more must fail with 409.
    """
    import main  # noqa: PLC0415

    item = _make_item(stock=3)
    app_client._session.get.return_value = item
    main.redis_client = app_client._redis  # type: ignore[attr-defined]

    resp = app_client.post(f"/menu-items/{item.id}/reserve", json={"quantity": 3})
    assert resp.status_code == 200
    assert resp.json()["remaining"] == 0

    item.stock_quantity = 0

    resp = app_client.post(f"/menu-items/{item.id}/reserve", json={"quantity": 1})
    assert resp.status_code == 409
