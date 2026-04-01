"""
Inventory Service — FastAPI app.

Handles restaurant and menu-item queries, plus stock reservation using
Redis distributed locks so concurrent orders cannot oversell finite items.
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid
from typing import Annotated, AsyncIterator

import redis.asyncio as aioredis
from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from models import Base, MenuItem, Restaurant


# ─── Settings ────────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://fooddelivery:changeme@localhost/fooddelivery"
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = ""

    @property
    def redis_url(self) -> str:
        if self.redis_password:
            return f"redis://:{self.redis_password}@{self.redis_host}:{self.redis_port}/0"
        return f"redis://{self.redis_host}:{self.redis_port}/0"


settings = Settings()


# ─── Database ─────────────────────────────────────────────────────────────────

engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session


DbDep = Annotated[AsyncSession, Depends(get_db)]


# ─── Redis ────────────────────────────────────────────────────────────────────

redis_client: aioredis.Redis | None = None

LOCK_TTL_SECONDS = 10
LOCK_RETRY_INTERVAL = 0.05
LOCK_MAX_RETRIES = 40


async def acquire_lock(item_id: uuid.UUID) -> bool:
    """Try to acquire a distributed lock for a menu item stock operation."""
    assert redis_client is not None
    key = f"lock:stock:{item_id}"
    for _ in range(LOCK_MAX_RETRIES):
        acquired = await redis_client.set(key, "1", nx=True, ex=LOCK_TTL_SECONDS)
        if acquired:
            return True
        await asyncio.sleep(LOCK_RETRY_INTERVAL)
    return False


async def release_lock(item_id: uuid.UUID) -> None:
    assert redis_client is not None
    await redis_client.delete(f"lock:stock:{item_id}")


# ─── Lifespan ─────────────────────────────────────────────────────────────────

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    yield
    await redis_client.aclose()
    await engine.dispose()


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Inventory Service",
    version="1.0.0",
    description="Restaurant & menu-item inventory with Redis-backed stock reservation",
    lifespan=lifespan,
)


# ─── Schemas ──────────────────────────────────────────────────────────────────

class MenuItemSchema(BaseModel):
    id: uuid.UUID
    restaurant_id: uuid.UUID
    name: str
    description: str | None
    price: float
    stock_quantity: int = Field(description="-1 means unlimited")
    available: bool

    class Config:
        from_attributes = True


class RestaurantSchema(BaseModel):
    id: uuid.UUID
    name: str
    address: str
    phone: str | None
    cuisine_type: str | None
    rating: float
    open_now: bool

    class Config:
        from_attributes = True


class ReserveRequest(BaseModel):
    quantity: int = Field(ge=1)


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/restaurants", response_model=list[RestaurantSchema])
async def list_restaurants(db: DbDep) -> list[Restaurant]:
    result = await db.execute(select(Restaurant))
    return list(result.scalars().all())


@app.get("/restaurants/{restaurant_id}", response_model=RestaurantSchema)
async def get_restaurant(restaurant_id: uuid.UUID, db: DbDep) -> Restaurant:
    row = await db.get(Restaurant, restaurant_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Restaurant not found")
    return row


@app.get("/restaurants/{restaurant_id}/menu", response_model=list[MenuItemSchema])
async def get_menu(restaurant_id: uuid.UUID, db: DbDep) -> list[MenuItem]:
    result = await db.execute(
        select(MenuItem).where(MenuItem.restaurant_id == restaurant_id)
    )
    return list(result.scalars().all())


@app.get("/menu-items/{item_id}", response_model=MenuItemSchema)
async def get_menu_item(item_id: uuid.UUID, db: DbDep) -> MenuItem:
    row = await db.get(MenuItem, item_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")
    return row


@app.post("/menu-items/{item_id}/reserve", status_code=status.HTTP_200_OK)
async def reserve_stock(item_id: uuid.UUID, body: ReserveRequest, db: DbDep) -> dict:
    """
    Attempt to reserve ``body.quantity`` units of a menu item.

    Uses a Redis distributed lock to prevent concurrent over-reservation.
    Items with ``stock_quantity == -1`` are unlimited and always succeed.
    """
    item = await db.get(MenuItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")

    if item.is_unlimited:
        return {"reserved": True, "remaining": -1}

    locked = await acquire_lock(item_id)
    if not locked:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not acquire stock lock — try again",
        )

    try:
        if item.stock_quantity < body.quantity:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Insufficient stock: available={item.stock_quantity}, requested={body.quantity}",
            )

        new_qty = item.stock_quantity - body.quantity
        await db.execute(
            update(MenuItem)
            .where(MenuItem.id == item_id)
            .values(stock_quantity=new_qty, available=new_qty > 0)
        )
        await db.commit()
        return {"reserved": True, "remaining": new_qty}
    finally:
        await release_lock(item_id)


@app.post("/menu-items/{item_id}/release", status_code=status.HTTP_200_OK)
async def release_stock(item_id: uuid.UUID, body: ReserveRequest, db: DbDep) -> dict:
    """Return previously reserved stock (e.g., on order cancellation)."""
    item = await db.get(MenuItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")

    if item.is_unlimited:
        return {"released": True, "remaining": -1}

    locked = await acquire_lock(item_id)
    if not locked:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not acquire stock lock — try again",
        )
    try:
        new_qty = item.stock_quantity + body.quantity
        await db.execute(
            update(MenuItem)
            .where(MenuItem.id == item_id)
            .values(stock_quantity=new_qty, available=True)
        )
        await db.commit()
        return {"released": True, "remaining": new_qty}
    finally:
        await release_lock(item_id)
