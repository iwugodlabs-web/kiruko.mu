# pylint: disable=invalid-name
"""Base class for SQLAlchemy"""
from sqlalchemy.ext.declarative import declarative_base, declared_attr


class CustomBase:
    """
    Automatically generate table names
    """
    @declared_attr
    def __tablename__(cls):
        return cls.__name__.lower()


Base = declarative_base(cls=CustomBase)
