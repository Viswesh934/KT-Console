# KT Console

KT Console helps teams turn a high-level project overview ("gist") into a structured, role-aware learning space with practice sessions, progress tracking, and owner-controlled agent Q&A.

## What's Included

- **Authentication & Team Access (`Phase 1`)**
  - Email/password sign-in and registration with PBKDF2-SHA256 hashing and `HttpOnly` cookie sessions (`kt_session`).
  - Owner-assigned project creation, 8-character team claim codes with 7-day expiry, code rotation, seat-limit enforcement, and member removal.
- **Project Workspace & Owner Settings (`Phase 2`)**
  - Dedicated `#project/<id>` workspace view with tabs for **Overview**, **Learning space**, **Agent Q&A**, and **Owner settings**.
  - Owners can edit the project name, approved gist, seat limit, and Agent Q&A controls.
- **Role-Aware Learning Space (`Phase 3`)**
  - Experience-level tracks (`junior`, `mid`, `senior`) that filter guides, edge cases, quizzes, and guided thinking sessions—and pass `experience_level` to `flagsmithClient.identify(...)`.
  - Owner CRUD for learning materials (`guide`, `edge_case`, `quiz`, `guided_session`) with optional source notes and answer rubrics.
  - Member progress tracking (`learning_progress`) with saved responses and completion counts.
- **Device-Code Agent Authorization & Scoped Q&A (`Phase 4`)**
  - Device-code authorization flow (`userCode` + `deviceCode`) for connecting CLI/IDE agents via `X-Agent-Device-Code`, with owner/member revocation.
  - Scoped Agent Q&A (`gist_only` or `gist_and_materials`) that answers strictly from approved context, cites sources, and logs usage for owner review.
- **Shared Foundation**
  - Cloudflare Worker (`src/worker.js`) + D1 SQLite migrations (`migrations/0001_initial.sql` – `0003_learning_and_agent.sql`).
  - Flagsmith JS SDK adapter (`public/flagsmith-client.js`) and hosted MCP config (`.mcp.json`) for `role_tracks`, `guided_sessions`, and `agent_qa`.

## Local Setup & Demo

1. Install dependencies:
   ```bash
   npm install
   ```
2. Apply local D1 migrations:
   ```bash
   npx wrangler d1 migrations apply kt-console --local
   ```
3. Start the local dev server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:8787` and sign in with the seeded local demo accounts (or create a new account):
   - **Owner (`Alex Morgan`):** `owner@ktconsole.dev` / `OwnerPass123!`
   - **Member (`Sam Rivera`):** `member@ktconsole.dev` / `MemberPass123!`

## Flagsmith & Verification

- `FLAGSMITH_ENVIRONMENT_ID`: public client-side environment key returned by `GET /api/config` to initialize the browser SDK.
- `FLAGSMITH_API_TOKEN`: organization API key used only by `.mcp.json` on the agent host (never exposed to the browser or Worker).
- Smoke checks:
  - `npm run check:flagsmith-client` — verifies the Flagsmith adapter offline.
  - `npm run check:flagsmith-cloud` — checks connectivity to Flagsmith Cloud.

## Deploying to Cloudflare (Optional)

1. Create a D1 database (`npx wrangler d1 create kt-console`) and set `database_id` in `wrangler.toml`.
2. Apply migrations remotely: `npx wrangler d1 migrations apply kt-console --remote`.
3. Deploy: `npm run deploy`.

## UI & Security Principles

- Minimalist, flat 2D layout with focused screens and clear action labels.
- Never expose system prompts, hidden instructions, or raw model traces in the UI.
- Agent context is opt-in and scoped to the approved project gist and learning materials—never the full workspace by default.
- Do not store secrets or private credentials in project gists.
