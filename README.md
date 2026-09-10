# ApproveFlow

ApproveFlow is a multi-tenant approval-workflow SaaS. This repository uses pnpm,
Turborepo, React, Express, and strict TypeScript.

## Prerequisites

- Node.js 22 or newer
- pnpm 10.17.1 (`corepack enable`)
- Docker with Compose for local PostgreSQL and Redis

## Setup

1. Copy `.env.example` to `.env` and keep local secrets out of source control.
2. Run `docker compose up -d`.
3. Run `pnpm install --frozen-lockfile` (use `pnpm install` only when intentionally
   updating dependencies).
4. Run `pnpm dev`.

The Compose stack also starts an isolated PostgreSQL test database on port
`5433`. Set `TEST_DATABASE_URL` as shown in `.env.example`; integration tests
may reset this database and must never target the development database.

The web app runs on `http://localhost:5173`; the API defaults to
`http://localhost:3000`, with health checks at `/health` and `/api/v1/health`.

## Quality checks

Run `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

Phase 2 contains foundation code only. Database migrations and business features
begin in later approved phases.
