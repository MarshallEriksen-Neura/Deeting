"""Drop transport/provider_type columns and transport indexes"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0011_drop_transport_provider_type"
down_revision = "0010_add_transport_and_is_stream_to_metrics_history"
branch_labels = None
depends_on = None


def upgrade():
    # Providers
    with op.batch_alter_table("providers") as batch:
        if op.get_bind().dialect.has_table(op.get_bind(), "providers"):
            batch.drop_column("transport")
            batch.drop_column("provider_type")

    # Provider presets
    with op.batch_alter_table("provider_presets") as batch:
        batch.drop_column("transport")
        batch.drop_column("provider_type")

    # Provider submissions
    with op.batch_alter_table("provider_submissions") as batch:
        batch.drop_column("provider_type")

    # Provider routing metrics history
    with op.batch_alter_table("provider_routing_metrics_history") as batch:
        batch.drop_constraint("uq_provider_routing_metrics_history_bucket", type_="unique")
        batch.drop_index("ix_provider_routing_metrics_history_provider_logical_window")
        batch.drop_column("transport")
        batch.create_unique_constraint(
            "uq_provider_routing_metrics_history_bucket",
            [
                "provider_id",
                "logical_model",
                "is_stream",
                "user_id",
                "api_key_id",
                "window_start",
            ],
        )
        batch.create_index(
            "ix_provider_routing_metrics_history_provider_logical_window",
            ["provider_id", "logical_model", "is_stream", "window_start"],
        )

    # User routing metrics history
    with op.batch_alter_table("user_routing_metrics_history") as batch:
        batch.drop_constraint("uq_user_routing_metrics_history_bucket", type_="unique")
        batch.drop_column("transport")
        batch.create_unique_constraint(
            "uq_user_routing_metrics_history_bucket",
            ["user_id", "provider_id", "logical_model", "is_stream", "window_start"],
        )

    # Aggregate metrics
    with op.batch_alter_table("aggregate_metrics") as batch:
        batch.drop_constraint("uq_aggregate_metrics_bucket", type_="unique")
        batch.drop_index("ix_aggregate_metrics_provider_logical_window")
        batch.drop_column("transport")
        batch.create_unique_constraint(
            "uq_aggregate_metrics_bucket",
            [
                "provider_id",
                "logical_model",
                "is_stream",
                "user_id",
                "api_key_id",
                "window_start",
                "window_duration",
            ],
        )
        batch.create_index(
            "ix_aggregate_metrics_provider_logical_window",
            ["provider_id", "logical_model", "is_stream", "user_id", "api_key_id", "window_start"],
        )


def downgrade():
    # Providers
    with op.batch_alter_table("providers") as batch:
        batch.add_column(sa.Column("transport", sa.String(length=16), nullable=False, server_default="http"))
        batch.add_column(sa.Column("provider_type", sa.String(length=16), nullable=False, server_default="native"))

    # Provider presets
    with op.batch_alter_table("provider_presets") as batch:
        batch.add_column(sa.Column("transport", sa.String(length=16), nullable=False, server_default="http"))
        batch.add_column(sa.Column("provider_type", sa.String(length=16), nullable=False, server_default="native"))

    # Provider submissions
    with op.batch_alter_table("provider_submissions") as batch:
        batch.add_column(sa.Column("provider_type", sa.String(length=16), nullable=False, server_default="native"))

    # Provider routing metrics history
    with op.batch_alter_table("provider_routing_metrics_history") as batch:
        batch.drop_constraint("uq_provider_routing_metrics_history_bucket", type_="unique")
        batch.drop_index("ix_provider_routing_metrics_history_provider_logical_window")
        batch.add_column(sa.Column("transport", sa.String(length=16), nullable=False, server_default="http"))
        batch.create_unique_constraint(
            "uq_provider_routing_metrics_history_bucket",
            [
                "provider_id",
                "logical_model",
                "transport",
                "is_stream",
                "user_id",
                "api_key_id",
                "window_start",
            ],
        )
        batch.create_index(
            "ix_provider_routing_metrics_history_provider_logical_window",
            ["provider_id", "logical_model", "transport", "is_stream", "window_start"],
        )

    # User routing metrics history
    with op.batch_alter_table("user_routing_metrics_history") as batch:
        batch.drop_constraint("uq_user_routing_metrics_history_bucket", type_="unique")
        batch.add_column(sa.Column("transport", sa.String(length=16), nullable=False, server_default="http"))
        batch.create_unique_constraint(
            "uq_user_routing_metrics_history_bucket",
            ["user_id", "provider_id", "logical_model", "transport", "is_stream", "window_start"],
        )

    # Aggregate metrics
    with op.batch_alter_table("aggregate_metrics") as batch:
        batch.drop_constraint("uq_aggregate_metrics_bucket", type_="unique")
        batch.drop_index("ix_aggregate_metrics_provider_logical_window")
        batch.add_column(sa.Column("transport", sa.String(length=16), nullable=False, server_default="http"))
        batch.create_unique_constraint(
            "uq_aggregate_metrics_bucket",
            [
                "provider_id",
                "logical_model",
                "transport",
                "is_stream",
                "user_id",
                "api_key_id",
                "window_start",
                "window_duration",
            ],
        )
        batch.create_index(
            "ix_aggregate_metrics_provider_logical_window",
            ["provider_id", "logical_model", "transport", "is_stream", "user_id", "api_key_id", "window_start"],
        )
