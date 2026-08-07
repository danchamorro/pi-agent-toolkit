---
name: exa-search
description: "Semantic web search and structured research using Exa. Use when you need web search, semantic search, similar-page discovery, content extraction from search results, direct answers with sources, or structured research over web sources. Triggers: exa, web search, semantic search, find similar, research, docs lookup, github search."
compatibility: "Requires Node.js plus an Exa API key via EXA_API_KEY or .env in this skill directory."
---

# Exa Search

Use this skill as the default Pi pathway for web search and research.

This skill is intentionally Pi-native. It does **not** rely on Claude-specific task orchestration or legacy harness path conventions. When this skill is loaded, choose the right Exa endpoint, build a JSON payload, run the local helper script with `bash`, and summarize the results with source links.

## When to use it

Use this skill when the user needs:
- semantic web search
- similar-page discovery from an existing URL
- content extraction from known Exa result IDs
- a direct answer sourced from web search
- structured research output over web sources
- current docs or recent web information that should not be guessed from memory

Do **not** use ad-hoc web fetching (`curl`, `wget`, custom requests scripts) when Exa can handle the request. This skill is the sanctioned web-search path for this Pi setup.

## Explicit invocation

You can load it directly with:

```text
/skill:exa-search <user request>
```

When invoked this way, treat the appended text as the user’s actual search/research request.

## Endpoint selection

Choose the endpoint that best matches intent:

- **search** — semantic web search, finding pages, docs, articles, repos, or papers
- **contents** — fetch full content for known Exa result IDs
- **findsimilar** — find pages similar to a given URL
- **answer** — produce a direct answer backed by Exa results
- **research** — produce structured research output following a requested schema

## Standard workflow

1. Understand the user’s question.
2. Pick the correct Exa endpoint.
3. Build a focused JSON payload.
4. Run the helper script with `bash`.
5. Read the JSON response.
6. Return a concise answer with cited source links.

If the user asks for current framework or library guidance, prefer official docs by setting `includeDomains` when appropriate.

## Helper script

Use the local helper script in this skill directory:

```text
scripts/exa-api.cjs
```

Run it with `node` and provide JSON through stdin, `--data`, or `--file`.

### General form

```bash
cat <<'JSON' | node scripts/exa-api.cjs <search|contents|findsimilar|answer|research>
{ ...payload... }
JSON
```

## Payload examples

### 1) Search

```bash
cat <<'JSON' | node scripts/exa-api.cjs search
{
  "query": "Latest research in LLMs",
  "type": "auto",
  "numResults": 10,
  "category": "research paper",
  "includeDomains": [],
  "excludeDomains": [],
  "startPublishedDate": "2025-01-01",
  "endPublishedDate": "2025-12-31",
  "includeText": [],
  "excludeText": [],
  "contents": {
    "text": true,
    "highlights": true,
    "summary": true
  }
}
JSON
```

**Search types:**
- `neural` — semantic search using embeddings
- `fast` — faster keyword-oriented search
- `auto` — default unless you have a reason to force another mode
- `deep` — more exhaustive search

**Common categories:**
- `company`
- `people`
- `research paper`
- `news`
- `pdf`
- `github`
- `tweet`

### 2) Contents

```bash
cat <<'JSON' | node scripts/exa-api.cjs contents
{
  "ids": ["result-id-1", "result-id-2"],
  "text": true,
  "highlights": true,
  "summary": true
}
JSON
```

### 3) Find Similar

```bash
cat <<'JSON' | node scripts/exa-api.cjs findsimilar
{
  "url": "https://example.com/article",
  "numResults": 10,
  "category": "news",
  "includeDomains": [],
  "excludeDomains": [],
  "startPublishedDate": "2025-01-01",
  "contents": {
    "text": true,
    "summary": true
  }
}
JSON
```

### 4) Answer

```bash
cat <<'JSON' | node scripts/exa-api.cjs answer
{
  "query": "What is the capital of France?",
  "numResults": 5,
  "includeDomains": [],
  "excludeDomains": []
}
JSON
```

### 5) Research

```bash
cat <<'JSON' | node scripts/exa-api.cjs research
{
  "input": "What are the latest developments in AI?",
  "model": "auto",
  "stream": false,
  "output_schema": {
    "properties": {
      "topic": {
        "type": "string",
        "description": "The main topic"
      },
      "key_findings": {
        "type": "array",
        "description": "List of key findings",
        "items": {
          "type": "string"
        }
      }
    },
    "required": ["topic"]
  },
  "citation_format": "numbered"
}
JSON
```

## API key configuration

The helper script checks for an API key in this order:

1. `EXA_API_KEY` environment variable
2. `.env` in this skill directory
3. `.env` next to `scripts/exa-api.cjs`

Example `.env`:

```dotenv
EXA_API_KEY=your_api_key_here
```

## Response handling

The helper returns JSON. Typical fields include:
- `requestId`
- `results`
- `searchType`
- `context`
- `costDollars`

After the helper runs:
- extract the most relevant findings
- cite source URLs clearly
- say when results are uncertain, sparse, or potentially stale
- prefer official documentation domains when the task is about APIs or framework behavior

## Practical guidance

- Keep search queries specific and realistic.
- Use `includeDomains` for official docs when verifying APIs.
- Use `excludeDomains` to avoid noisy sources.
- Use `contents` when you already have Exa result IDs and need fuller text.
- Use `findsimilar` when the user gives a canonical page and wants adjacent resources.
- Use `research` only when the user truly needs structured synthesis.
- Do not dump raw JSON unless the user asks for it.

## Output style

Return concise, decision-useful results:
- short summary first
- then key findings
- then source links
- mention limitations or uncertainty when relevant
