---
name: api-contract-validator
description: Validate API integration code against API contracts and schemas. Use when implementing, refactoring, reviewing, or debugging code that calls REST, GraphQL, gRPC, SDK, or webhook APIs, especially when OpenAPI specs, GraphQL schemas, protobufs, SDK types, TypeScript interfaces, Pydantic models, or documented request/response contracts are available.
---

# API Contract Validator

Validate API integration code against explicit or inferred contracts. Focus on request shape, response handling, authentication, error handling, version compatibility, and runtime safety.

## When to use

Use this skill when working with:

- REST clients, GraphQL clients, gRPC clients, SDKs, webhook handlers, or typed API wrappers
- OpenAPI or Swagger specs, JSON Schema, GraphQL schemas, protobufs, SDK documentation, TypeScript types, Pydantic models, or API docs
- API bugs involving 4xx or 5xx responses, missing fields, unexpected response shapes, auth failures, or schema drift
- dependency upgrades that may change an API or SDK contract

Do not invent contract requirements. If no formal contract exists, clearly label findings as inferred from code, docs, tests, examples, or observed payloads.

## Workflow

### 1. Locate the contract

Search for likely contract sources:

- `openapi.json`, `openapi.yaml`, `swagger.json`, `swagger.yaml`
- `*.schema.json`, `schema.graphql`, `*.gql`, `*.proto`
- SDK type declarations, TypeScript interfaces, generated clients, Pydantic models, dataclasses, or typed response models
- API docs, README files, examples, tests, fixtures, and recorded payloads

If multiple versions exist, identify which version the implementation uses.

### 2. Locate API integration code

Find request construction and response handling:

- Python: `requests`, `httpx`, `aiohttp`, SDK clients
- JavaScript and TypeScript: `fetch`, `axios`, generated clients, SDK clients
- Go: `http.Client`, generated clients, SDK clients
- GraphQL queries and mutations
- webhook parsing and signature verification

Trace from the public method or handler to the boundary where data leaves or enters the system.

### 3. Validate requests

Check:

- required fields, path params, query params, headers, and auth material
- field names, types, enum values, nullability, formats, constraints, and defaults
- content type, accept headers, serialization, date/time formats, pagination, idempotency keys, and retry-safe behavior
- SDK method names, parameter order, version compatibility, and generated type usage

### 4. Validate responses and errors

Check:

- success response fields are accessed safely and typed correctly
- nullable or optional fields are handled explicitly
- pagination, partial success, empty responses, and async job states are handled
- documented 4xx and 5xx responses are handled with meaningful error behavior
- webhook payloads validate signatures, event types, idempotency, and replay behavior where relevant

### 5. Report findings

Use this format:

```markdown
# API Contract Validation Report

## Summary
- Status: PASS | WARNINGS | FAIL
- Contract sources: <files or docs used>
- Coverage: <what was validated and what was not>

## Critical findings
- `file:line` - <contract violation>
  - Expected: <contract requirement>
  - Actual: <implementation behavior>
  - Fix: <specific change>

## Warnings
- `file:line` - <risk or likely mismatch>
  - Evidence: <why this matters>
  - Fix: <specific change or verification>

## Info
- `file:line` - <optional improvement>

## Unvalidated assumptions
- <anything inferred rather than verified against a contract>
```

## Severity guide

- **Critical**: likely runtime failure, data loss, auth failure, missing required field, invalid type, unhandled documented error, webhook signature risk, or breaking version mismatch
- **Warning**: incomplete defensive handling, deprecated field or endpoint, weak validation, optional field assumptions, missing test coverage for contract behavior
- **Info**: clarity, typing, docs, and maintainability improvements

## Principles

- Prefer exact file references and concrete fixes.
- Validate against the project’s existing patterns before recommending new abstractions.
- Distinguish verified contract violations from inferred risks.
- Do not hide uncertainty. State what needs a live API call, fixture, or upstream doc to confirm.
