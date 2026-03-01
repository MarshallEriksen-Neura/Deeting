from __future__ import annotations

from typing import Any

from loguru import logger

from app.models.user_notification_channel import NotificationChannel
from app.services.notifications.base import (
    NotificationContent,
    NotificationResult,
    NotificationSender,
    NotificationSenderRegistry,
)


@NotificationSenderRegistry.register(NotificationChannel.EMAIL)
class EmailSender(NotificationSender):
    """邮件通知发送器"""

    channel = NotificationChannel.EMAIL

    async def validate_config(self, config: dict[str, Any]) -> tuple[bool, str | None]:
        required_fields = ["smtp_host", "smtp_port", "from_email", "from_name"]
        for field in required_fields:
            if not config.get(field):
                return False, f"缺少必填字段: {field}"

        smtp_port = config.get("smtp_port")
        if smtp_port and isinstance(smtp_port, str):
            try:
                smtp_port = int(smtp_port)
            except ValueError:
                return False, "smtp_port 必须是数字"

        return True, None

    async def send(
        self,
        user_channel_config: dict[str, Any],
        content: NotificationContent,
    ) -> NotificationResult:
        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.header import Header

            smtp_host = user_channel_config.get("smtp_host")
            smtp_port = int(user_channel_config.get("smtp_port", 25))
            from_email = user_channel_config.get("from_email")
            from_name = user_channel_config.get("from_name", "Deeting")
            to_email = user_channel_config.get("to_email")

            username = user_channel_config.get("username")
            password = user_channel_config.get("password")

            if not to_email:
                return NotificationResult(
                    success=False,
                    channel=self.channel,
                    error="缺少目标邮箱地址",
                )

            msg = MIMEText(content.content, "plain", "utf-8")
            msg["Subject"] = Header(content.title, "utf-8")
            msg["From"] = f"{from_name} <{from_email}>"
            msg["To"] = to_email

            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                if user_channel_config.get("use_tls", True):
                    server.starttls()

                if username and password:
                    server.login(username, password)

                server.sendmail(from_email, [to_email], msg.as_string())

            return NotificationResult(
                success=True,
                channel=self.channel,
                message="邮件发送成功",
            )

        except smtplib.SMTPException as e:
            logger.exception("EmailSender.send SMTP failed")
            return NotificationResult(
                success=False,
                channel=self.channel,
                error=f"SMTP 错误: {str(e)}",
            )
        except Exception as e:
            logger.exception("EmailSender.send failed")
            return NotificationResult(
                success=False,
                channel=self.channel,
                error=str(e),
            )
