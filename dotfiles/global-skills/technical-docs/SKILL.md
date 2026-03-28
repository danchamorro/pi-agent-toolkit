---
name: technical-docs
description: Standards and best practices for creating technical documentation. Use when the user requests documentation updates or asks to create README files, API docs, user guides, or docstrings.
context: fork
---

# Technical Documentation Standards

Follow these guidelines to create clear, maintainable technical documentation across all formats.

## Using This Skill

When creating or updating documentation:

1. Identify the documentation type (README, API docs, docstrings, user guide)
2. Apply the relevant sections below based on the type
3. Follow the Documentation Workflow (Section 3) as the process guide
4. Use Core Writing Standards (Section 4) for all content
5. Reference `references/diagrams.md` guidelines when adding visual elements
6. Reference `references/examples.md` for complete before/after samples
7. Run through the Quality Checklist (Section 8) before finalizing
8. Optionally use `scripts/validate_docs.py` to automate validation checks

**For docstrings:** Focus on "Python Documentation" section (6.1)
**For API docs:** Focus on "API Documentation" section (5)
**For guides/READMEs:** Apply "Core Writing Standards" comprehensively (Section 4)

## Documentation Workflow

Follow this workflow when creating documentation:

1. **Understand the audience and purpose** - Determine technical depth needed
2. **Structure the content** - Use logical hierarchy with clear sections
3. **Write concisely** - Active voice, present tense, focused sentences
4. **Include examples** - Provide runnable code samples
5. **Validate accuracy** - Cross-reference with actual implementation
6. **Review for clarity** - Read from target audience perspective

## Core Writing Standards

### Structure and Organization

- Start with concise overview explaining "what" and "why"
- Use hierarchical headings (H1 → H2 → H3) for logical flow
- Include table of contents for documents >3 sections
- Place most important information first (inverted pyramid)
- Group related concepts in coherent sections

### Writing Style

- Use active voice and present tense: "The function returns" not "will return"
- For user-facing instructions, write in second person: "You can configure"
- Keep sentences concise and single-focused
- Define technical terms on first use
- Maintain consistent terminology (avoid synonym alternation)

### Code Examples

- Provide complete, runnable examples demonstrating real use cases
- Include both basic and advanced examples when appropriate
- Add comments explaining non-obvious logic
- Show expected output/results when relevant
- Use syntax highlighting with proper language tags
- Follow project coding standards (type hints, docstrings, etc.)

### Formatting Conventions

- Use code blocks (```) for multi-line code, inline code (`) for short references
- Format file paths, commands, environment variables as code
- **Bold** for important concepts, *italics* for emphasis (sparingly)
- Use bullet points for lists, numbered lists for sequential steps

## API Documentation

Document APIs with these required elements:

- Document all parameters with types, descriptions, required/optional status
- Specify return types and possible return values
- List all exceptions/errors with triggering conditions
- Include authentication/authorization requirements
- Provide curl examples or SDK usage examples
- Document rate limits, pagination, constraints

## Project-Specific Conventions

### Python Documentation

Follow these Python-specific standards from the project:

**Docstring Format:**
- Use Sphinx-style docstrings: `:param`, `:returns`, `:raises`
- Include type hints in all function signatures (not just in docstrings)
- Document each parameter, return value, and exception

**Example from this codebase:**
```python
def build_audience(
    self,
    target_type: TargetType,
    source: MatchSource | ListSource,
    name: str,
    *,
    description: str = "",
    external_id: str = "",
) -> AudienceBuildResponse:
    """Build a new audience using the Bridge API.

    :param target_type: Type of audience target (INDIVIDUAL or HOUSEHOLD)
    :param source: Source configuration (MatchSource for file matching, ListSource for lists)
    :param name: Human-readable audience name
    :param description: Optional audience description
    :param external_id: Optional external identifier for tracking
    :returns: Response containing process ID and initial status
    :raises BridgeAPIError: If API request fails
    :raises ValueError: If required credentials are missing
    """
```

**Code Documentation Patterns:**
- Reference Pydantic models for data structures
- Document context managers and resource cleanup
- Explain purpose of explicit flags and typed parameters
- Show proper enum usage (e.g., `TargetType.INDIVIDUAL` not strings)
- Include logging examples with loguru-style format strings: `logger.info("Building audience for client {}", client_name)`

**Resource Management:**
Document context managers with cleanup guarantees:
```python
@contextmanager
def _resource_context(self) -> Generator[Resource, None, None]:
    """Context manager for resource lifecycle.

    Ensures proper cleanup in both test and production scenarios.

    :yields: Configured resource instance
    :raises ConnectionError: If resource initialization fails
    """
```

### Code References

When referencing code in documentation, always include clickable links with line numbers:

- Format: `[language.SymbolName](relative/path/file.py:LLineNumber)`
- Example: `[python.BridgeAPIClient](src/bridge_tap_api/sdk/bridge/client.py:L42)` - Main client class
- For ranges: `[L283-290](src/bridge_tap_api/sdk/bridge/client.py:L283-290)`
- Verify line numbers are accurate before including

## Visual Communication

See [references/diagrams.md](references/diagrams.md) for comprehensive diagram and table usage guidelines including:

- When to use Mermaid diagrams vs prose
- Diagram types (flowcharts, sequence, state, class)
- Table formatting for parameters, configurations, comparisons
- Best practices and anti-patterns

## Documentation Examples

See [references/examples.md](references/examples.md) for complete before/after examples demonstrating these standards in practice, including:

- Poor vs good docstrings
- Poor vs good README structure
- Poor vs good API documentation
- Common mistakes and corrections

## Quality Checklist

Before finalizing documentation, verify these requirements:

**Technical Accuracy**

- Cross-reference with actual code implementation
- Test all code examples
- Validate parameter types and return values
- Confirm file paths and links

**Completeness**

- All public APIs/functions documented
- Edge cases and error conditions covered
- Prerequisites and dependencies listed
- Setup/installation steps complete

**Links and References**

- All hyperlinks tested (not broken)
- Internal cross-references point to existing sections
- External documentation links are current
- Code references point to actual files/functions with correct line numbers

**Consistency**

- Terminology used consistently throughout
- Formatting follows established patterns
- Tone and voice are uniform
- Examples follow same style

**Clarity**

- Written for target audience perspective
- Complex explanations simplified
- Logical flow between sections
- Examples progress simple → complex
