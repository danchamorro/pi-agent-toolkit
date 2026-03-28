# Bridge-TAP API Reference Implementation

Complete reference implementation of Google Chat Cards v2 for error alerting.

## Full Client Implementation

```python
"""Google Chat client for sending notifications to Google Chat spaces."""

import os
from datetime import UTC, datetime
from types import TracebackType
from typing import Any, ClassVar

import httpx
from loguru import logger
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from bridge_tap_api.sdk.google_chat.models import (
    ChatSendMessageRequest,
    ChatSendMessageResponse,
    ErrorAlertPayload,
    ErrorCategory,
    GoogleChatClientConfig,
    MessageType,
    SeverityLevel,
)

# Shared retry configuration for network errors
_RETRY_CONFIG = retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError)),
)


class GoogleChatClient:
    """Client for sending messages to Google Chat spaces."""

    MAX_MESSAGE_LENGTH = 4096
    TRUNCATION_SUFFIX = "\n...[truncated]"

    def __init__(self, config: GoogleChatClientConfig) -> None:
        self.config = config
        self.client = httpx.Client(timeout=config.timeout)

        if not self.config.webhook_url and not self.config.allow_empty_webhook:
            logger.warning("No webhook URL provided. Messages will not be sent.")

    def __enter__(self) -> "GoogleChatClient":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        self.client.close()

    def _validate_webhook(self, operation: str) -> ChatSendMessageResponse | None:
        """Validate webhook URL is configured."""
        if not self.config.webhook_url:
            logger.error("No webhook URL configured. {} not sent.", operation)
            return ChatSendMessageResponse(success=False, error="No webhook URL configured")
        return None

    @_RETRY_CONFIG
    def send_card(self, card_payload: dict[str, Any]) -> ChatSendMessageResponse:
        """Send a Cards v2 message to Google Chat."""
        if error := self._validate_webhook("Card"):
            return error
        if "cardsV2" not in card_payload:
            logger.error("Invalid card payload: missing 'cardsV2' key")
            return ChatSendMessageResponse(success=False, error="Invalid card payload: missing 'cardsV2' key")
        return self._send_request(card_payload)

    def _send_request(self, payload: dict[str, Any]) -> ChatSendMessageResponse:
        """Send a request to the Google Chat webhook."""
        try:
            response = self.client.post(
                self.config.webhook_url,
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()

            logger.info("Message sent to Google Chat successfully")
            response_data = response.json() if response.content else {}
            return ChatSendMessageResponse(success=True, response_data=response_data)

        except httpx.HTTPStatusError as e:
            error_msg = f"HTTP error sending to Google Chat: {e.response.status_code}"
            logger.error("Failed to send message to Google Chat: {}", error_msg)
            return ChatSendMessageResponse(success=False, error=error_msg)

        except httpx.RequestError as e:
            error_msg = f"Request error sending to Google Chat: {e}"
            logger.error("Failed to send message to Google Chat: {}", error_msg)
            raise


class ErrorAlerter:
    """Specialized alerter for sending error notifications to Google Chat."""

    SERVICE_NAME: ClassVar[str] = "bridge-tap-api"

    CATEGORY_TITLE_MAP: ClassVar[dict[ErrorCategory, str]] = {
        ErrorCategory.CONFIG_ERROR: "Configuration Error",
        ErrorCategory.SYSTEM_ERROR: "System Error",
        ErrorCategory.ETL_REQUIRED: "ETL Required",
        ErrorCategory.USER_FILE: "User File Error",
    }

    # Google Material Symbols icons served from Google Fonts CDN.
    # Source: https://fonts.google.com/icons
    SEVERITY_ICON_URLS: ClassVar[dict[SeverityLevel, str]] = {
        SeverityLevel.CRITICAL: "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/error/default/48px.svg",
        SeverityLevel.HIGH: "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/warning/default/48px.svg",
        SeverityLevel.MEDIUM: "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/info/default/48px.svg",
        SeverityLevel.LOW: "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/check_circle/default/48px.svg",
    }

    def __init__(self, webhook_url: str | None = None) -> None:
        if webhook_url is not None:
            self.webhook_url = webhook_url or os.getenv("GOOGLE_CHAT_ERROR_WEBHOOK_URL", "")
        else:
            self.webhook_url = os.getenv("GOOGLE_CHAT_ERROR_WEBHOOK_URL", "")
        config = GoogleChatClientConfig(
            webhook_url=self.webhook_url,
            allow_empty_webhook=not self.webhook_url,
        )
        self._client = GoogleChatClient(config=config)

    def __enter__(self) -> "ErrorAlerter":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def send_alert(
        self,
        error_category: str,
        job: dict[str, Any],
        error_info: dict[str, Any],
        severity: str = "medium",
    ) -> bool:
        """Send alert to Google Chat webhook for error notification."""
        if not self.webhook_url:
            logger.warning("No webhook URL configured. Alert not sent for job {}", job.get("id", "unknown"))
            return False

        alert_payload = self._build_alert_payload(error_category, job, error_info, severity)
        card_payload = self._build_card_payload(alert_payload)

        logger.info(
            "Sending {} alert to Google Chat for job {} (severity: {})",
            error_category,
            job.get("id", "unknown"),
            severity,
        )

        response = self._client.send_card(card_payload)

        if response.success:
            logger.info("Alert sent successfully to Google Chat for job {}", job.get("id", "unknown"))
            return True
        logger.error("Failed to send alert to Google Chat: {}", response.error)
        return False

    def _build_alert_payload(
        self,
        error_category: str,
        job: dict[str, Any],
        error_info: dict[str, Any],
        severity: str,
    ) -> ErrorAlertPayload:
        """Build structured alert payload for Google Chat."""
        job_id = int(job.get("id", 0))
        ticket_id = str(job.get("ticket_id", "unknown"))
        client_name = str(job.get("client_name", "unknown"))

        stage = error_info.get("stage", "unknown")
        error_message = error_info.get("error_message", "Unknown error")
        error_type = error_info.get("error_type", "UnknownError")

        try:
            category_enum = ErrorCategory(error_category)
        except ValueError:
            category_enum = ErrorCategory.SYSTEM_ERROR

        try:
            severity_enum = SeverityLevel(severity)
        except ValueError:
            severity_enum = SeverityLevel.MEDIUM

        return ErrorAlertPayload(
            timestamp=datetime.now(UTC),
            error_category=category_enum,
            severity=severity_enum,
            job_id=job_id,
            ticket_id=ticket_id,
            client_name=client_name,
            stage=stage,
            error_message=f"{error_type}: {error_message}",
            retry_count=job.get("retry_count", 0),
            max_retries=job.get("max_retries", 0),
        )

    def _build_card_payload(self, payload: ErrorAlertPayload) -> dict[str, Any]:
        """Build Cards v2 payload for Google Chat webhook (BCC pattern)."""
        card_id = f"alert-{payload.job_id}-{payload.timestamp.strftime('%Y%m%d%H%M%S')}"

        return {
            "cardsV2": [
                {
                    "cardId": card_id,
                    "card": {
                        "header": self._build_card_header(payload),
                        "sections": [
                            self._build_job_info_section(payload),
                            self._build_error_details_section(payload),
                            self._build_error_message_section(payload),
                        ],
                    },
                }
            ]
        }

    def _build_card_header(self, payload: ErrorAlertPayload) -> dict[str, Any]:
        """Build the card header section."""
        return {
            "title": f"Bridge-TAP Alert: {self.CATEGORY_TITLE_MAP.get(payload.error_category, 'Error')}",
            "subtitle": self.SERVICE_NAME,
            "imageUrl": self.SEVERITY_ICON_URLS.get(payload.severity),
            "imageType": "CIRCLE",
        }

    def _build_job_info_section(self, payload: ErrorAlertPayload) -> dict[str, Any]:
        """Build the job information section with decorated text widgets."""
        return {
            "widgets": [
                {
                    "decoratedText": {
                        "startIcon": {"knownIcon": "BOOKMARK"},
                        "topLabel": "Job ID",
                        "text": str(payload.job_id),
                    }
                },
                {
                    "decoratedText": {
                        "startIcon": {"knownIcon": "DESCRIPTION"},
                        "topLabel": "Ticket ID",
                        "text": payload.ticket_id,
                    }
                },
                {
                    "decoratedText": {
                        "startIcon": {"knownIcon": "PERSON"},
                        "topLabel": "Client",
                        "text": payload.client_name,
                    }
                },
                {
                    "decoratedText": {
                        "startIcon": {"knownIcon": "CLOCK"},
                        "topLabel": "Timestamp",
                        "text": payload.timestamp.strftime("%Y-%m-%d %H:%M:%S UTC"),
                    }
                },
            ]
        }

    def _build_error_details_section(self, payload: ErrorAlertPayload) -> dict[str, Any]:
        """Build the error details section."""
        return {
            "header": "Error Details",
            "widgets": [
                {"decoratedText": {"topLabel": "Stage", "text": payload.stage}},
                {"decoratedText": {"topLabel": "Category", "text": payload.error_category.value}},
                {"decoratedText": {"topLabel": "Severity", "text": payload.severity.value}},
                {"decoratedText": {"topLabel": "Retries", "text": f"{payload.retry_count}/{payload.max_retries}"}},
            ],
        }

    def _build_error_message_section(self, payload: ErrorAlertPayload) -> dict[str, Any]:
        """Build the error message section."""
        return {
            "header": "Error Message",
            "widgets": [{"textParagraph": {"text": payload.error_message}}],
        }
```

## Pydantic Models

```python
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict


class ErrorCategory(str, Enum):
    """Categories for error classification."""
    CONFIG_ERROR = "config_error"
    SYSTEM_ERROR = "system_error"
    ETL_REQUIRED = "etl_required"
    USER_FILE = "user_file"


class SeverityLevel(str, Enum):
    """Severity levels for alerts."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ErrorAlertPayload(BaseModel):
    """Payload for error alerts."""
    model_config = ConfigDict(frozen=True)

    timestamp: datetime
    error_category: ErrorCategory
    severity: SeverityLevel
    job_id: int
    ticket_id: str
    client_name: str
    stage: str
    error_message: str
    retry_count: int = 0
    max_retries: int = 0


class ChatSendMessageResponse(BaseModel):
    """Response from sending a message."""
    model_config = ConfigDict(frozen=True)

    success: bool
    error: str | None = None
    response_data: dict[str, Any] | None = None


class GoogleChatClientConfig(BaseModel):
    """Configuration for Google Chat client."""
    model_config = ConfigDict(frozen=True)

    webhook_url: str = ""
    timeout: float = 30.0
    allow_empty_webhook: bool = False
```

## Test Fixtures

```python
from collections.abc import Generator
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from bridge_tap_api.sdk.google_chat.client import ErrorAlerter, GoogleChatClient
from bridge_tap_api.sdk.google_chat.models import (
    ErrorCategory,
    GoogleChatClientConfig,
    SeverityLevel,
)


@pytest.fixture
def google_chat_client() -> Generator[GoogleChatClient, None, None]:
    """Create a GoogleChatClient for testing."""
    config = GoogleChatClientConfig(webhook_url="https://webhook.test")
    client = GoogleChatClient(config=config)
    yield client
    client.close()


@pytest.fixture
def alerter() -> Generator[ErrorAlerter, None, None]:
    """Create an ErrorAlerter for testing."""
    alerter = ErrorAlerter(webhook_url="https://webhook.test")
    yield alerter
    alerter.close()


@pytest.fixture
def mock_successful_response() -> MagicMock:
    """Create a mock successful HTTP response."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = b'{"name": "spaces/xxx/messages/yyy"}'
    mock_response.json.return_value = {"name": "spaces/xxx/messages/yyy"}
    mock_response.raise_for_status = MagicMock()
    return mock_response


@pytest.fixture
def sample_job() -> dict:
    """Create a sample job dictionary for testing."""
    return {
        "id": 123,
        "ticket_id": "TICKET-456",
        "client_name": "test-client",
        "retry_count": 2,
        "max_retries": 6,
    }


@pytest.fixture
def sample_error_info() -> dict:
    """Create sample error info for testing."""
    return {
        "stage": "validation",
        "error_type": "ValidationError",
        "error_message": "Required column 'email' is missing",
    }
```

## Example Test

```python
def test_send_alert_builds_card_v2_payload(
    alerter: ErrorAlerter,
    mock_successful_response: MagicMock,
    sample_job: dict,
    sample_error_info: dict,
) -> None:
    """Test that send_alert builds proper Cards v2 structure."""
    with patch.object(alerter._client.client, "post", return_value=mock_successful_response):
        result = alerter.send_alert(
            error_category="config_error",
            job=sample_job,
            error_info=sample_error_info,
            severity="high",
        )

    assert result is True

    # Verify cardsV2 structure
    call_args = alerter._client.client.post.call_args
    payload = call_args.kwargs["json"]

    assert "cardsV2" in payload
    card = payload["cardsV2"][0]["card"]

    # Verify header
    assert card["header"]["title"] == "Bridge-TAP Alert: Configuration Error"
    assert card["header"]["subtitle"] == "bridge-tap-api"
    assert "warning" in card["header"]["imageUrl"]  # HIGH severity uses warning icon

    # Verify sections
    assert len(card["sections"]) == 3
```
