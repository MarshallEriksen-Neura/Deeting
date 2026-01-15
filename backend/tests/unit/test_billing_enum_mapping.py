
from sqlalchemy.dialects import postgresql

from app.models.billing import BillingTransaction, TransactionStatus, TransactionType


def _bind_enum_value(column, value):
    processor = column.type.bind_processor(postgresql.dialect())
    assert processor is not None
    return processor(value)


def test_billing_transaction_status_uses_enum_values():
    status_value = _bind_enum_value(
        BillingTransaction.__table__.c.status,
        TransactionStatus.COMMITTED,
    )
    assert status_value == TransactionStatus.COMMITTED.value


def test_billing_transaction_type_uses_enum_values():
    type_value = _bind_enum_value(
        BillingTransaction.__table__.c.type,
        TransactionType.DEDUCT,
    )
    assert type_value == TransactionType.DEDUCT.value
