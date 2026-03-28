---
name: google-chat-cards-v2
description: Implement Google Chat Cards v2 format for rich alert notifications. This skill should be used when migrating from plain text messages to Cards v2 format, adding visual alerts to Google Chat webhooks, or building card-based notification systems.
context: fork
---

# Google Chat Cards v2 Implementation

This skill provides patterns and guidance for implementing Google Chat Cards v2 rich message format in Python services.

## When to Use

- Migrating existing plain text Google Chat alerts to Cards v2 format
- Adding new alert/notification functionality with rich formatting
- Implementing error alerting systems with structured card layouts

## Cards v2 Structure

Cards v2 uses a nested structure with header, sections, and widgets:

```json
{
  "cardsV2": [{
    "cardId": "unique-card-id",
    "card": {
      "header": {
        "title": "Alert Title",
        "subtitle": "service-name",
        "imageUrl": "https://icon-url.svg",
        "imageType": "CIRCLE"
      },
      "sections": [
        {
          "header": "Section Header (optional)",
          "widgets": [...]
        }
      ]
    }
  }]
}
```

## Implementation Pattern

### Step 1: Add Module-Level Retry Configuration

Extract retry configuration to a module-level constant for reuse across methods:

```python
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential
import httpx

# Shared retry configuration for network errors
_RETRY_CONFIG = retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError)),
)
```

### Step 2: Add send_card() Method

Add a method to send Cards v2 payloads alongside existing `send_message()`:

```python
@_RETRY_CONFIG
def send_card(self, card_payload: dict[str, Any]) -> ChatSendMessageResponse:
    """Send a Cards v2 message to Google Chat.

    :param card_payload: The card payload dict with cardsV2 structure.
    :returns: Response containing success status.
    """
    if error := self._validate_webhook("Card"):
        return error
    if "cardsV2" not in card_payload:
        logger.error("Invalid card payload: missing 'cardsV2' key")
        return ChatSendMessageResponse(success=False, error="Invalid card payload: missing 'cardsV2' key")
    return self._send_request(card_payload)
```

### Step 3: Define Class Constants

Use ClassVar for static mappings that define card content:

```python
from typing import ClassVar

class AlerterClass:
    SERVICE_NAME: ClassVar[str] = "my-service-name"

    CATEGORY_TITLE_MAP: ClassVar[dict[ErrorCategory, str]] = {
        ErrorCategory.CONFIG_ERROR: "Configuration Error",
        ErrorCategory.SYSTEM_ERROR: "System Error",
        # ... add your categories
    }

    # Google Material Symbols icons from Google Fonts CDN
    # Source: https://fonts.google.com/icons
    SEVERITY_ICON_URLS: ClassVar[dict[SeverityLevel, str]] = {
        SeverityLevel.CRITICAL: "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/error/default/48px.svg",
        SeverityLevel.HIGH: "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/warning/default/48px.svg",
        SeverityLevel.MEDIUM: "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/info/default/48px.svg",
        SeverityLevel.LOW: "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/check_circle/default/48px.svg",
    }
```

### Step 4: Build Card Payload with Helper Methods

Break card building into focused helper methods:

```python
def _build_card_payload(self, payload: ErrorAlertPayload) -> dict[str, Any]:
    """Build Cards v2 payload for Google Chat webhook."""
    card_id = f"alert-{payload.job_id}-{payload.timestamp.strftime('%Y%m%d%H%M%S')}"

    return {
        "cardsV2": [{
            "cardId": card_id,
            "card": {
                "header": self._build_card_header(payload),
                "sections": [
                    self._build_job_info_section(payload),
                    self._build_error_details_section(payload),
                    self._build_error_message_section(payload),
                ],
            },
        }]
    }

def _build_card_header(self, payload: ErrorAlertPayload) -> dict[str, Any]:
    """Build the card header section."""
    return {
        "title": f"Alert: {self.CATEGORY_TITLE_MAP.get(payload.error_category, 'Error')}",
        "subtitle": self.SERVICE_NAME,
        "imageUrl": self.SEVERITY_ICON_URLS.get(payload.severity),
        "imageType": "CIRCLE",
    }
```

## Widget Types

### Decorated Text (with icons)

Use for key-value pairs with optional icons:

```python
{
    "decoratedText": {
        "startIcon": {"knownIcon": "BOOKMARK"},  # Optional icon
        "topLabel": "Job ID",
        "text": "12345",
    }
}
```

Available `knownIcon` values: `BOOKMARK`, `DESCRIPTION`, `PERSON`, `CLOCK`, `EMAIL`, `STAR`, etc.

### Decorated Text (label only)

For simpler key-value display:

```python
{"decoratedText": {"topLabel": "Stage", "text": "validation"}}
```

### Text Paragraph

For longer text content:

```python
{"textParagraph": {"text": "Error message or description here"}}
```

## Section Structure

Sections can have an optional header and contain widgets:

```python
{
    "header": "Error Details",  # Optional
    "widgets": [
        {"decoratedText": {"topLabel": "Stage", "text": payload.stage}},
        {"decoratedText": {"topLabel": "Category", "text": payload.error_category.value}},
    ],
}
```

## Testing Pattern

Use pytest fixtures for reusable test setup:

```python
@pytest.fixture
def alerter() -> Generator[ErrorAlerter, None, None]:
    alerter = ErrorAlerter(webhook_url="https://webhook.test")
    yield alerter
    alerter.close()

@pytest.fixture
def mock_successful_response() -> MagicMock:
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = b'{"name": "spaces/xxx/messages/yyy"}'
    mock_response.json.return_value = {"name": "spaces/xxx/messages/yyy"}
    mock_response.raise_for_status = MagicMock()
    return mock_response

def test_send_alert_builds_card_v2_payload(alerter, mock_successful_response):
    """Test that send_alert builds proper Cards v2 structure."""
    with patch.object(alerter._client.client, "post", return_value=mock_successful_response):
        result = alerter.send_alert(...)

    # Verify cardsV2 structure
    call_args = alerter._client.client.post.call_args
    payload = call_args.kwargs["json"]
    assert "cardsV2" in payload
    assert payload["cardsV2"][0]["card"]["header"]["title"] == "Expected Title"
```

## Reference Implementation

See `references/bridge_tap_implementation.md` for the complete reference implementation from bridge-tap-api.

## Checklist

When implementing Cards v2:

1. [ ] Add module-level `_RETRY_CONFIG` constant
2. [ ] Add `send_card()` method with validation
3. [ ] Define `SERVICE_NAME` class constant
4. [ ] Define `CATEGORY_TITLE_MAP` for alert titles
5. [ ] Define `SEVERITY_ICON_URLS` with Google Material Symbols
6. [ ] Create `_build_card_payload()` method
7. [ ] Create helper methods for each section
8. [ ] Update tests with pytest fixtures
9. [ ] Verify card structure in tests
10. [ ] Run type checks (mypy) and linting (ruff)
