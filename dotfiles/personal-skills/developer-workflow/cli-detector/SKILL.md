---
name: cli-detector
description: >
  Scan a repository to discover all external SaaS tools and services it integrates with,
  then determine whether each has an official CLI. Use this skill whenever the user asks
  to find CLIs for their project, audit third-party service integrations, discover what
  external services a codebase depends on, check for official CLI tools, or wants to know
  "what services does this repo use." Also trigger when the user asks about automating
  service management, scripting deployments, or wants to interact with their project's
  services from the terminal.
---

# CLI Detector

Analyze a repository to identify every external SaaS service it integrates with, then
research whether each service provides an official CLI tool.

The workflow has three phases: **Detect**, **Verify**, **Report**. Do not skip or
reorder these phases.

## Phase 1: Detect services

Scan the repository using all applicable detection vectors below. Each vector catches
services the others miss, so work through every one that applies to this project's
language ecosystem.

### What counts as an "external service"

An external service is a hosted platform or SaaS product that the application connects
to over the network. The company behind it manages the infrastructure.

**Include:** Stripe, Sentry, Clerk, Auth0, Vercel, AWS S3, Twilio, SendGrid, Resend,
Datadog, LaunchDarkly, Algolia, Supabase, Neon, PlanetScale, Upstash, DigitalOcean,
Cloudflare, Firebase, GitHub (as a service), Netlify, Fly.io, Render, Railway, etc.

**Exclude (these are never external services):**
- Generic database clients: `mysql2`, `pg`, `psycopg2`, `database/sql`, `SQLAlchemy`
- Generic protocols: SSH libraries, HTTP clients (`axios`, `requests`, `fetch`)
- Frameworks: Next.js, Django, Rails, Express, FastAPI
- ORMs: Drizzle, Prisma, TypeORM, ActiveRecord
- UI libraries: React, Vue, Tailwind, Bootstrap
- Build tools, runtimes, test runners, linters, formatters

The test: if removing the integration means losing access to a *third-party managed
platform* (not just a protocol or library), it is an external service.

### Vector 1: Package manager manifests

Read dependency files for SDK packages from known service vendors.

| Ecosystem | Files |
|-----------|-------|
| Node.js / TypeScript | `package.json` |
| Python | `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile` |
| Go | `go.mod` |
| Ruby | `Gemfile` |
| Rust | `Cargo.toml` |
| Java / Kotlin | `build.gradle`, `pom.xml` |
| PHP | `composer.json` |
| .NET | `*.csproj`, `packages.config` |

Vendor-namespaced packages are strong signals: `@sentry/nextjs`, `@clerk/nextjs`,
`stripe`, `boto3`, `google-cloud-storage`.

### Vector 2: Environment variables

Search source code for env var access patterns and collect all variable names.

| Language | Search pattern |
|----------|---------------|
| Node.js / TypeScript | `process.env.VARIABLE_NAME` |
| Python | `os.environ`, `os.getenv()` |
| Go | `os.Getenv("VARIABLE")` |
| Ruby | `ENV["VARIABLE"]`, `ENV.fetch` |

Also check `.env.example`, `.env.sample`, `.env.template` files.

Variable names reveal services: `STRIPE_SECRET_KEY` -> Stripe, `SENTRY_DSN` -> Sentry,
`CLERK_SECRET_KEY` -> Clerk, `RESEND_API_KEY` -> Resend, `DO_API_TOKEN` -> DigitalOcean,
`UPSTASH_REDIS_REST_URL` -> Upstash, `AWS_ACCESS_KEY_ID` -> AWS, etc.

### Vector 3: Configuration files

Service-specific config files at the project root:

`sentry.*.config.ts` -> Sentry, `vercel.json` / `.vercel/` -> Vercel,
`firebase.json` -> Firebase, `netlify.toml` -> Netlify, `fly.toml` -> Fly.io,
`wrangler.toml` -> Cloudflare Workers, `serverless.yml` -> check provider field,
`render.yaml` -> Render, `railway.json` -> Railway

### Vector 4: Source code imports and API URLs

Search for direct SDK imports and hardcoded API base URLs:

```bash
# Service SDK imports (adapt patterns to the project's language)
grep -r "from '@sentry\|from \"@sentry\|require('@sentry" src/
grep -r "api.digitalocean.com\|api.stripe.com\|api.sendgrid.com" src/
```

### Vector 5: Implicit / indirect signals

Some services leave clues without explicit SDK imports. **Actively search** for these
patterns rather than waiting to stumble on them:

```bash
# Vercel signals
grep -r "maxDuration" src/ --include="*.ts" --include="*.tsx" -l
grep -r "CRON_SECRET" src/ --include="*.ts" --include="*.tsx" -l
ls vercel.json .vercel/ 2>/dev/null

# Heroku signals
ls Procfile app.json 2>/dev/null

# Hosting platform from git remote
git remote -v 2>/dev/null
```

- **Vercel**: `maxDuration` exports in API route files are Vercel-specific serverless
  config. `CRON_SECRET` is a Vercel Cron Jobs feature. `@vercel/*` packages.
- **GitHub**: git remote pointing to github.com, `.github/` directory with workflows.
- **GitLab**: git remote pointing to gitlab.com, `.gitlab-ci.yml`.
- **Heroku**: `Procfile`, `app.json`.

### Vector 6: CI/CD pipelines

Scan pipeline configs for service references not visible in application code:

- `.github/workflows/*.yml`: `uses:` actions, secrets references
- `.gitlab-ci.yml`, `.circleci/config.yml`, `Jenkinsfile`

## Phase 2: Verify CLI existence with Exa

This phase is mandatory. Do not determine CLI status from memory or training data.

Service CLIs are launched and deprecated frequently. Training data is often wrong
about whether a specific service has a CLI, especially for newer or smaller services.
The only reliable way to determine CLI status is to check externally.

### What qualifies as an "official CLI"

All four criteria must be met:
- Created and maintained by the service provider (not a community wrapper)
- Purpose-built to interact with that specific service
- Has official documentation from the provider
- Available through standard package managers (npm, brew, apt, pip, etc.)

### Verification procedure

For **every** service identified in Phase 1, call `exa_search` with the `answer`
endpoint:

```
exa_search endpoint=answer query="Does [SERVICE_NAME] have an official CLI tool?"
```

This returns the CLI name, install command, and source links. If the answer is
ambiguous or uncertain, follow up with a targeted doc-site search:

```
exa_search endpoint=search query="[SERVICE_NAME] CLI"
  includeDomains=["official-docs-domain.com"]
```

Do not mark any service as "No CLI" without first running an Exa query for it.
Even services that seem unlikely to have a CLI (auth providers, email services,
newer startups) should be verified. CLI tooling is expanding rapidly and assumptions
from training data are frequently wrong.

## Phase 3: Report

Present findings in two tables.

### Primary table: services with CLI status

| # | Service | Usage in This Repo | Official CLI? | CLI Name | Install |
|---|---------|-------------------|:---:|----------|---------|
| 1 | **Stripe** | Payment processing (`stripe` SDK, `STRIPE_SECRET_KEY`) | Yes | `stripe` | `brew install stripe/stripe-cli/stripe` |
| 2 | **SomeService** | Feature flags (`SOMESERVICE_API_KEY`) | No | N/A | N/A |

The "Usage in This Repo" column should include:
- What the service is used for (brief)
- How it was detected (SDK name, env var, config file)

### Secondary table: excluded items

| Tool | Reason excluded |
|------|----------------|
| MySQL (`mysql2`) | Generic database client, not an external service |

This table shows the user you considered these tools and correctly filtered them.
It demonstrates thoroughness.
