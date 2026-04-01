from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, DeclarativeBase
import uuid


class Base(DeclarativeBase):
    pass


class Restaurant(Base):
    __tablename__ = "restaurants"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    address = Column(Text, nullable=False)
    phone = Column(String(30))
    cuisine_type = Column(String(100))
    rating = Column(Float, default=0.0)
    open_now = Column(Boolean, default=True)

    menu_items = relationship(
        "MenuItem", back_populates="restaurant", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Restaurant id={self.id} name={self.name!r}>"


class MenuItem(Base):
    """
    Represents an item on a restaurant's menu.

    ``stock_quantity = -1`` means the item has **unlimited** availability
    (e.g., freshly made dishes). Any value >= 0 is a finite stock count
    that must be reserved with a Redis distributed lock before decrement.
    """

    __tablename__ = "menu_items"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    restaurant_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("restaurants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(255), nullable=False)
    description = Column(Text)
    price = Column(Float, nullable=False)
    stock_quantity = Column(
        Integer,
        nullable=False,
        default=-1,
        comment="-1 means unlimited stock",
    )
    available = Column(Boolean, nullable=False, default=True)

    restaurant = relationship("Restaurant", back_populates="menu_items")

    @property
    def is_unlimited(self) -> bool:
        return int(self.stock_quantity) == -1

    def __repr__(self) -> str:
        stock = "unlimited" if self.is_unlimited else self.stock_quantity
        return f"<MenuItem id={self.id} name={self.name!r} stock={stock}>"
