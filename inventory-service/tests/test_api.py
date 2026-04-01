"""
Tests for the Inventory Service API.

PostgreSQL and Redis are fully mocked — no external services needed.
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


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_menu_item(stock_quantity: int = -1, available: bool = True):
    """Build a mock MenuItem with the given stock state."""
    item = MagicMock()
    item.id = uuid.uuid4()
    item.restaurant_id = uuid.uuid4()
    item.name = "Burger"
    item.description = "Tasty burger"
    item.price = 9.99
    item.stock_quantity = stock_quantity
    item.is_unlimited = stock_quantity == -1
    item.available = available
    return item


def _make_restaurant():
    r = MagicMock()
    r.id = uuid.uuid4()
    r.name = "Test Restaurant"
    r.address = "123 Main St"
    r.phone = "+1-555-0000"
    r.cuisine_type = "American"
    r.rating = 4.5
    r.open_now = True
    return r


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture()
def mock_session():
    """Async SQLAlchemy session with sensible defaults (empty results)."""
    session = AsyncMock()
    session.get.return_value = None          # not-found by default
    session.commit = AsyncMock()

    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    session.execute.return_value = result

    return session


@pytest.fixture()
def client(mock_session):
    import main  # noqa: PLC0415 — must import after sys.path insert

    async def _override_get_db():
        yield mock_session

    main.app.dependency_overrides[main.get_db] = _override_get_db

    # AsyncEngine.begin is read-only, so replace the entire engine object.
    # The lifespan does: async with engine.begin() as conn: conn.run_sync(...)
    # and at teardown: await engine.dispose()
    mock_conn = AsyncMock()
    mock_conn.run_sync = AsyncMock()

    @asynccontextmanager
    async def _mock_begin():
        yield mock_conn

    mock_engine = MagicMock()
    mock_engine.begin = _mock_begin
    mock_engine.dispose = AsyncMock()

    mock_redis = AsyncMock()
    mock_redis.set = AsyncMock(return_value=True)   # lock always acquired
    mock_redis.delete = AsyncMock()
    mock_redis.aclose = AsyncMock()

    with patch("main.engine", mock_engine), \
         patch("main.aioredis.from_url", return_value=mock_redis):
        with TestClient(main.app, raise_server_exceptions=True) as c:
            c.mock_redis = mock_redis  # type: ignore[attr-defined]
            yield c

    main.app.dependency_overrides.clear()


# ─── Health ───────────────────────────────────────────────────────────────────

def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ─── Restaurants ──────────────────────────────────────────────────────────────

def test_list_restaurants_empty(client):
    resp = client.get("/restaurants")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_restaurants_returns_items(client, mock_session):
    restaurant = _make_restaurant()
    result = MagicMock()
    result.scalars.return_value.all.return_value = [restaurant]
    mock_session.execute.return_value = result

    resp = client.get("/restaurants")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == restaurant.name


def test_get_restaurant_not_found(client):
    resp = client.get(f"/restaurants/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_get_restaurant_found(client, mock_session):
    restaurant = _make_restaurant()
    mock_session.get.return_value = restaurant

    resp = client.get(f"/restaurants/{restaurant.id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == restaurant.name


# ─── Menu items ───────────────────────────────────────────────────────────────

def test_get_menu_item_not_found(client):
    resp = client.get(f"/menu-items/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_get_menu_item_found(client, mock_session):
    item = _make_menu_item()
    mock_session.get.return_value = item

    resp = client.get(f"/menu-items/{item.id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == item.name


def test_get_menu_empty(client, mock_session):
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    mock_session.execute.return_value = result

    resp = client.get(f"/restaurants/{uuid.uuid4()}/menu")
    assert resp.status_code == 200
    assert resp.json() == []


# ─── Stock reservation ────────────────────────────────────────────────────────

def test_reserve_invalid_quantity_rejected(client):
    """quantity < 1 must be rejected with 422."""
    resp = client.post(f"/menu-items/{uuid.uuid4()}/reserve", json={"quantity": 0})
    assert resp.status_code == 422


def test_reserve_item_not_found(client):
    resp = client.post(f"/menu-items/{uuid.uuid4()}/reserve", json={"quantity": 1})
    assert resp.status_code == 404


def test_reserve_unlimited_item_always_succeeds(client, mock_session):
    """Items with stock_quantity == -1 skip the lock and always succeed."""
    item = _make_menu_item(stock_quantity=-1)
    mock_session.get.return_value = item

    resp = client.post(f"/menu-items/{item.id}/reserve", json={"quantity": 99})
    assert resp.status_code == 200
    data = resp.json()
    assert data["reserved"] is True
    assert data["remaining"] == -1


def test_reserve_finite_stock_success(client, mock_session):
    """Successful reservation decrements the count."""
    import main  # noqa: PLC0415

    item = _make_menu_item(stock_quantity=10)
    mock_session.get.return_value = item

    # Ensure lock is acquired
    main.redis_client = client.mock_redis  # type: ignore[attr-defined]

    resp = client.post(f"/menu-items/{item.id}/reserve", json={"quantity": 3})
    assert resp.status_code == 200
    data = resp.json()
    assert data["reserved"] is True
    assert data["remaining"] == 7


def test_reserve_insufficient_stock(client, mock_session):
    """Requesting more than available must return 409."""
    import main  # noqa: PLC0415

    item = _make_menu_item(stock_quantity=2)
    mock_session.get.return_value = item

    main.redis_client = client.mock_redis  # type: ignore[attr-defined]

    resp = client.post(f"/menu-items/{item.id}/reserve", json={"quantity": 5})
    assert resp.status_code == 409
    assert "insufficient" in resp.json()["detail"].lower()


# ─── Stock release ────────────────────────────────────────────────────────────

def test_release_item_not_found(client):
    resp = client.post(f"/menu-items/{uuid.uuid4()}/release", json={"quantity": 1})
    assert resp.status_code == 404


def test_release_unlimited_item(client, mock_session):
    item = _make_menu_item(stock_quantity=-1)
    mock_session.get.return_value = item

    resp = client.post(f"/menu-items/{item.id}/release", json={"quantity": 5})
    assert resp.status_code == 200
    assert resp.json()["remaining"] == -1


def test_release_finite_stock(client, mock_session):
    """Released units should be added back."""
    import main  # noqa: PLC0415

    item = _make_menu_item(stock_quantity=5)
    mock_session.get.return_value = item

    main.redis_client = client.mock_redis  # type: ignore[attr-defined]

    resp = client.post(f"/menu-items/{item.id}/release", json={"quantity": 3})
    assert resp.status_code == 200
    data = resp.json()
    assert data["released"] is True
    assert data["remaining"] == 8
