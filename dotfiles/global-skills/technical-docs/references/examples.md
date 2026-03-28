# Documentation Examples

This document provides complete before/after examples demonstrating technical documentation standards in practice.

## Python Docstrings

### ❌ Poor Docstring Example

```python
def process_file(client, file_path, options=None):
    """Process a file."""
    # Implementation
    pass
```

**Problems:**
- No parameter descriptions
- No type information
- No return value documentation
- No exception documentation
- Vague description

### ✅ Good Docstring Example

```python
def process_file(
    client_name: str,
    file_path: Path,
    options: dict[str, Any] | None = None,
) -> ProcessingResult:
    """Process a client file and return validation results.

    Reads the file from the specified path, validates the column mappings
    against the client's configuration, and returns a structured result
    containing validation status and any errors found.

    :param client_name: Name of the client (must exist in clients/ directory)
    :param file_path: Absolute path to the file to process
    :param options: Optional processing configuration overrides
    :returns: ProcessingResult containing status, row counts, and error details
    :raises FileNotFoundError: If file_path does not exist
    :raises ValueError: If client_name is not configured
    :raises ProcessingError: If file validation fails
    """
    # Implementation
    pass
```

**Improvements:**
- Type hints for all parameters and return value
- Clear, specific description of purpose
- Each parameter documented with context
- Return value structure explained
- All exceptions documented with conditions

## README Structure

### ❌ Poor README Example

```markdown
# My Project

This is a cool project.

## Install

pip install myproject

## Usage

from myproject import Client
client = Client()
client.do_stuff()
```

**Problems:**
- No purpose or context
- No prerequisites
- No authentication/configuration
- Code examples lack language tags
- No explanation of what "do_stuff" does
- Missing error handling examples

### ✅ Good README Example

```markdown
# Bridge TAP API

Python SDK and worker system for building audiences using the Bridge API with file-based matching.

## Overview

The Bridge TAP API provides:
- **SDK Client**: Type-safe Python client for Bridge API interactions
- **Worker System**: Background job processing for audience building
- **Validation Pipeline**: File validation before audience creation
- **Database Layer**: PostgreSQL-based state management

## Prerequisites

- Python 3.11+
- PostgreSQL 14+
- AWS credentials for S3 access
- Bridge API account with API key

## Installation

```bash
pip install bridge-tap-api
```

## Quick Start

### Basic Usage

```python
from bridge_tap_api.sdk.bridge import BridgeAPIClient, BridgeApiConfig
from bridge_tap_api.sdk.bridge.models import TargetType, MatchSource

# Configure client
config = BridgeApiConfig(
    account_id="your_account_id",
    api_key="your_api_key",
)
client = BridgeAPIClient(config)

# Build audience from S3 file
source = MatchSource(
    s3_uri="s3://bucket/path/to/file.csv",
    column_mappings={"email": "email_address", "first_name": "fname"},
)

response = client.build_audience(
    target_type=TargetType.INDIVIDUAL,
    source=source,
    name="My Audience",
)

print(f"Audience build started: {response.pid}")
```

### Error Handling

```python
from bridge_tap_api.sdk.bridge.exceptions import BridgeAPIError

try:
    response = client.build_audience(...)
except BridgeAPIError as e:
    print(f"API error: {e.message}, Status: {e.status_code}")
except ValueError as e:
    print(f"Configuration error: {e}")
```

## Configuration

Set environment variables:

```bash
export BRIDGE_API_KEY="your_key"
export BRIDGE_ACCOUNT_ID="your_account"
export AWS_ACCESS_KEY_ID="your_key"
export AWS_SECRET_ACCESS_KEY="your_secret"
```

Or use configuration files (see [Configuration Guide](docs/configuration.md)).

## Documentation

- [API Reference](docs/api-reference.md)
- [Architecture Overview](docs/architecture.md)
- [Development Guide](docs/development.md)

## License

MIT License - see LICENSE file for details.
```

**Improvements:**
- Clear project purpose and value proposition
- Organized sections with logical flow
- Prerequisites listed upfront
- Complete, runnable code examples with syntax highlighting
- Error handling examples
- Configuration options documented
- Links to detailed documentation
- Professional structure

## API Documentation

### ❌ Poor API Documentation

```markdown
## build_audience

Builds an audience.

**Parameters:**
- target_type
- source
- name

**Returns:** response
```

**Problems:**
- No parameter types or descriptions
- No required/optional indicators
- No return value structure
- No error documentation
- No usage examples

### ✅ Good API Documentation

```markdown
## build_audience()

Build a new audience using the Bridge API with file-based matching or list-based targeting.

**Method Signature:**

```python
def build_audience(
    self,
    target_type: TargetType,
    source: MatchSource | ListSource,
    name: str,
    *,
    description: str = "",
    external_id: str = "",
) -> AudienceBuildResponse
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target_type` | `TargetType` | Yes | Audience target type: `TargetType.INDIVIDUAL` or `TargetType.HOUSEHOLD` |
| `source` | `MatchSource \| ListSource` | Yes | Source configuration. Use `MatchSource` for S3 file matching or `ListSource` for list-based audiences |
| `name` | `str` | Yes | Human-readable audience name (3-100 characters) |
| `description` | `str` | No | Optional audience description for documentation |
| `external_id` | `str` | No | Optional external identifier for tracking |

**Returns:**

`AudienceBuildResponse` containing:
- `pid` (str): Process ID for status tracking
- `status` (str): Initial status (typically "PENDING")
- `created_at` (datetime): Timestamp of creation

**Raises:**

| Exception | Condition |
|-----------|-----------|
| `BridgeAPIError` | API request fails (network, auth, server errors) |
| `ValueError` | Missing required credentials or invalid parameters |
| `ValidationError` | Invalid source configuration or column mappings |

**Example Usage:**

```python
from bridge_tap_api.sdk.bridge import BridgeAPIClient, BridgeApiConfig
from bridge_tap_api.sdk.bridge.models import TargetType, MatchSource

config = BridgeApiConfig(account_id="12345", api_key="key_abc")
client = BridgeAPIClient(config)

# Build match-based audience
source = MatchSource(
    s3_uri="s3://my-bucket/audience.csv",
    column_mappings={
        "email": "user_email",
        "first_name": "fname",
        "last_name": "lname",
    },
)

response = client.build_audience(
    target_type=TargetType.INDIVIDUAL,
    source=source,
    name="Q4 Campaign Audience",
    description="Target audience for Q4 email campaign",
    external_id="campaign_q4_2024",
)

print(f"Build started with PID: {response.pid}")

# Poll for status
status = client.check_status(response.pid)
print(f"Current status: {status.state}")
```

**See Also:**
- [check_status()](#check_status) - Poll audience build status
- [get_audience_details()](#get_audience_details) - Retrieve final results
- [MatchSource](models.md#matchsource) - File-based source configuration
```

**Improvements:**
- Complete method signature with types
- Comprehensive parameter table
- Return value structure documented
- All exceptions with conditions
- Multiple usage examples
- Cross-references to related methods
- Professional formatting

## Common Mistakes and Corrections

### Mistake 1: Implicit Behavior

❌ **Poor:**
```python
def process(data=None):
    """Process data or use default."""
    pass
```

✅ **Good:**
```python
def process(data: dict[str, Any] | None = None, *, use_default: bool = False) -> Result:
    """Process data with explicit configuration.

    :param data: Input data dictionary, or None to skip processing
    :param use_default: If True, use default configuration when data is None
    :returns: Processing result with status and metadata
    :raises ValueError: If data is None and use_default is False
    """
    pass
```

### Mistake 2: Missing Context

❌ **Poor:**
```python
def validate(file):
    """Validate file."""
    pass
```

✅ **Good:**
```python
def validate_client_file(
    client_name: str,
    file_path: Path,
) -> ValidationResult:
    """Validate client file against configured column requirements.

    Checks that the file contains all required columns defined in the
    client's validation configuration and that column types match expectations.

    :param client_name: Client identifier (matches clients/ directory name)
    :param file_path: Path to CSV or Parquet file to validate
    :returns: ValidationResult with is_valid flag and list of errors
    :raises FileNotFoundError: If file_path does not exist
    :raises ConfigurationError: If client has no validation config
    """
    pass
```

### Mistake 3: Vague Error Documentation

❌ **Poor:**
```markdown
**Raises:**
- Exception: If something goes wrong
```

✅ **Good:**
```markdown
**Raises:**

| Exception | Condition |
|-----------|-----------|
| `FileNotFoundError` | The specified file_path does not exist |
| `ConfigurationError` | Client validation config is missing or invalid |
| `ValidationError` | File is missing required columns or has type mismatches |
| `S3Error` | Cannot access S3 file (permissions, network, invalid URI) |
```

### Mistake 4: Untested Code Examples

❌ **Poor:**
```python
# Untested, may not work
client.do_something(param)
```

✅ **Good:**
```python
# Tested, runnable example
from bridge_tap_api.sdk.bridge import BridgeAPIClient, BridgeApiConfig

config = BridgeApiConfig(account_id="123", api_key="key")
client = BridgeAPIClient(config)

result = client.build_audience(
    target_type=TargetType.INDIVIDUAL,
    source=source,
    name="Example Audience",
)

assert result.pid is not None
print(f"Success: {result.pid}")
```

## Inline Comments

### ❌ Poor Inline Comments

```python
# Get the data
data = load_data()

# Process it
result = process(data)

# Check if valid
if result:
    # Do something
    save(result)
```

**Problems:**
- Comments just restate code
- No explanation of WHY
- No context about business logic

### ✅ Good Inline Comments

```python
# Load client configuration to determine required columns.
# This must happen before validation to catch config errors early.
config = load_client_config(client_name)

# Bridge API requires email + (first_name or last_name) minimum.
# Validate before expensive S3 upload to fail fast.
if not has_required_columns(data, config.required_columns):
    raise ValidationError("Missing required identity columns")

# Use household targeting for B2B campaigns (decision per requirements doc).
target_type = TargetType.HOUSEHOLD if config.is_b2b else TargetType.INDIVIDUAL
```

**Improvements:**
- Explains WHY, not WHAT
- Provides business context
- References requirements/decisions
- Explains non-obvious choices
