from __future__ import annotations

import base64
import json
import textwrap
import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import quote_plus, urlencode

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding


@dataclass(slots=True)
class AlipayPageOrder:
    out_trade_no: str
    pay_url: str
    amount: Decimal


@dataclass(slots=True)
class AlipayTradeQueryResult:
    code: str
    sub_code: str | None
    msg: str | None
    out_trade_no: str
    trade_no: str | None
    trade_status: str | None
    total_amount: Decimal | None
    seller_id: str | None
    raw_response: dict[str, str]


class AlipayService:
    _OUT_TRADE_NO_PREFIX = "rcg"

    def __init__(
        self,
        *,
        enabled: bool,
        app_id: str,
        gateway: str,
        app_private_key: str,
        alipay_public_key: str,
        notify_url: str,
        return_url: str,
        timeout_express: str,
        seller_id: str = "",
    ) -> None:
        self.enabled = enabled
        self.app_id = app_id.strip()
        self.gateway = gateway.strip() or "https://openapi.alipay.com/gateway.do"
        self.app_private_key = app_private_key.strip()
        self.alipay_public_key = alipay_public_key.strip()
        self.notify_url = notify_url.strip()
        self.return_url = return_url.strip()
        self.timeout_express = timeout_express.strip() or "15m"
        self.seller_id = seller_id.strip()

    def create_page_order(
        self,
        *,
        tenant_id: str,
        amount: float | Decimal,
        subject: str,
        body: str,
    ) -> AlipayPageOrder:
        self._ensure_ready_for_create_order()
        normalized_amount = self.normalize_amount(amount)
        out_trade_no = self.build_out_trade_no(tenant_id=tenant_id, amount=normalized_amount)
        params = self._build_api_params(
            method="alipay.trade.page.pay",
            biz_content={
                "out_trade_no": out_trade_no,
                "product_code": "FAST_INSTANT_TRADE_PAY",
                "total_amount": f"{normalized_amount:.2f}",
                "subject": subject[:128] or "Credits Recharge",
                "body": body[:256],
                "timeout_express": self.timeout_express,
            },
            include_notify_url=True,
            include_return_url=True,
        )
        pay_url = f"{self.gateway}?{urlencode(params, quote_via=quote_plus)}"

        return AlipayPageOrder(
            out_trade_no=out_trade_no,
            pay_url=pay_url,
            amount=normalized_amount,
        )

    async def query_trade(self, *, out_trade_no: str) -> AlipayTradeQueryResult:
        self._ensure_ready_for_trade_query()
        params = self._build_api_params(
            method="alipay.trade.query",
            biz_content={"out_trade_no": out_trade_no},
            include_notify_url=False,
            include_return_url=False,
            response_format="JSON",
        )

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(self.gateway, data=params)
            response.raise_for_status()
            payload = response.json()

        result = payload.get("alipay_trade_query_response") or {}
        total_amount_raw = result.get("total_amount")
        total_amount = None
        if total_amount_raw not in {None, ""}:
            total_amount = Decimal(str(total_amount_raw)).quantize(Decimal("0.01"))

        return AlipayTradeQueryResult(
            code=str(result.get("code") or ""),
            sub_code=str(result.get("sub_code") or "") or None,
            msg=str(result.get("msg") or "") or None,
            out_trade_no=str(result.get("out_trade_no") or out_trade_no),
            trade_no=str(result.get("trade_no") or "") or None,
            trade_status=str(result.get("trade_status") or "") or None,
            total_amount=total_amount,
            seller_id=str(result.get("seller_id") or "") or None,
            raw_response={
                str(key): str(value)
                for key, value in result.items()
                if value is not None and value != ""
            },
        )

    def verify_notify_signature(self, payload: dict[str, str]) -> bool:
        sign = (payload.get("sign") or "").strip()
        if not sign:
            return False

        sign_type = (payload.get("sign_type") or "RSA2").upper()
        if sign_type != "RSA2":
            return False

        unsigned_payload = {
            key: value
            for key, value in payload.items()
            if key not in {"sign", "sign_type"} and value is not None and value != ""
        }
        if not unsigned_payload:
            return False

        sign_content = self._build_sign_content(unsigned_payload)
        return self._verify(sign_content=sign_content, sign=sign, sign_type=sign_type)

    @classmethod
    def build_out_trade_no(
        cls,
        *,
        tenant_id: str,
        amount: Decimal,
    ) -> str:
        tenant_hex = uuid.UUID(str(tenant_id)).hex
        cents = int((amount * Decimal("100")).to_integral_value(rounding=ROUND_HALF_UP))
        if cents <= 0:
            raise ValueError("充值金额必须大于 0")
        if cents > 9_999_999_999:
            raise ValueError("充值金额超出支付宝订单号编码范围")
        nonce = uuid.uuid4().hex[:8]
        return f"{cls._OUT_TRADE_NO_PREFIX}{tenant_hex}{cents:010d}{nonce}"

    @classmethod
    def parse_out_trade_no(cls, out_trade_no: str) -> tuple[str, Decimal]:
        raw = (out_trade_no or "").strip().lower()
        if not raw.startswith(cls._OUT_TRADE_NO_PREFIX):
            raise ValueError("非法的支付宝订单号")
        payload = raw[len(cls._OUT_TRADE_NO_PREFIX) :]
        if len(payload) != 50:
            raise ValueError("非法的支付宝订单号长度")

        tenant_hex = payload[:32]
        cents_raw = payload[32:42]
        nonce = payload[42:]
        if (
            any(ch not in "0123456789abcdef" for ch in tenant_hex)
            or not cents_raw.isdigit()
            or any(ch not in "0123456789abcdef" for ch in nonce)
        ):
            raise ValueError("非法的支付宝订单号格式")

        tenant_id = str(uuid.UUID(hex=tenant_hex))
        cents = int(cents_raw)
        amount = (Decimal(cents) / Decimal("100")).quantize(Decimal("0.01"))
        return tenant_id, amount

    @staticmethod
    def normalize_amount(amount: float | Decimal) -> Decimal:
        normalized = Decimal(str(amount))
        if normalized <= 0:
            raise ValueError("充值金额必须大于 0")
        normalized = normalized.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if normalized <= 0:
            raise ValueError("充值金额必须大于 0")
        return normalized

    def _ensure_ready_for_create_order(self) -> None:
        self._ensure_ready()
        if not self.notify_url:
            raise ValueError("支付宝异步通知地址未配置")

    def _ensure_ready_for_trade_query(self) -> None:
        self._ensure_ready()

    def _ensure_ready(self) -> None:
        if not self.enabled:
            raise ValueError("支付宝充值未开启")
        if not self.app_id:
            raise ValueError("支付宝 APP_ID 未配置")
        if not self.app_private_key:
            raise ValueError("支付宝应用私钥未配置")
        if not self.alipay_public_key:
            raise ValueError("支付宝公钥未配置")

    @staticmethod
    def _build_sign_content(payload: dict[str, str]) -> str:
        pairs: list[str] = []
        for key in sorted(payload.keys()):
            value = payload[key]
            if value is None or value == "":
                continue
            if not isinstance(value, str):
                value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            pairs.append(f"{key}={value}")
        return "&".join(pairs)

    def _build_api_params(
        self,
        *,
        method: str,
        biz_content: dict[str, str],
        include_notify_url: bool,
        include_return_url: bool,
        response_format: str | None = None,
    ) -> dict[str, str]:
        params: dict[str, str] = {
            "app_id": self.app_id,
            "method": method,
            "charset": "utf-8",
            "sign_type": "RSA2",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "version": "1.0",
            "biz_content": json.dumps(
                biz_content,
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        }
        if response_format:
            params["format"] = response_format
        if include_notify_url:
            params["notify_url"] = self.notify_url
        if include_return_url and self.return_url:
            params["return_url"] = self.return_url

        sign_content = self._build_sign_content(params)
        params["sign"] = self._sign(sign_content)
        return params

    def _sign(self, sign_content: str) -> str:
        private_key = serialization.load_pem_private_key(
            self._normalize_private_key(self.app_private_key),
            password=None,
        )
        signature = private_key.sign(
            sign_content.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return base64.b64encode(signature).decode("utf-8")

    def _verify(self, *, sign_content: str, sign: str, sign_type: str) -> bool:
        algorithm = hashes.SHA256()
        public_key = serialization.load_pem_public_key(
            self._normalize_public_key(self.alipay_public_key)
        )
        try:
            public_key.verify(
                base64.b64decode(sign.replace(" ", "+")),
                sign_content.encode("utf-8"),
                padding.PKCS1v15(),
                algorithm,
            )
            return True
        except (InvalidSignature, ValueError):
            return False

    @staticmethod
    def _normalize_private_key(key: str) -> bytes:
        key = key.strip().replace("\r", "")
        if "BEGIN" in key:
            return key.encode("utf-8")

        wrapped = "\n".join(textwrap.wrap("".join(key.split()), 64))
        pem = f"-----BEGIN PRIVATE KEY-----\n{wrapped}\n-----END PRIVATE KEY-----\n"
        return pem.encode("utf-8")

    @staticmethod
    def _normalize_public_key(key: str) -> bytes:
        key = key.strip().replace("\r", "")
        if "BEGIN" in key:
            return key.encode("utf-8")

        wrapped = "\n".join(textwrap.wrap("".join(key.split()), 64))
        pem = f"-----BEGIN PUBLIC KEY-----\n{wrapped}\n-----END PUBLIC KEY-----\n"
        return pem.encode("utf-8")
