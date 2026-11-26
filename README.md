# KT Console

KT Console helps teams get a useful gist of a project and learn it through role-aware guides and practice. This first slice establishes the deployable product shell, project/team foundation, Cloudflare API and D1 schema, and Flagsmith connection.

## Product work split

### Person 1 — Project and team access

- Project creation, project gist, and seat limits
- Team claim-code joining and membership
- Owner settings for agent Q&A, scope, usage, and revocation
- Device-code agent authorization flow (follow-up; requires user identity and consent)

### Person 2 — Learning experience

- Project overview and learning space
- Guides and edge cases for junior, mid-level, and senior users
- Quizzes and guided thinking sessions
- Material source/context and learning progress

### Shared foundation

- Cloudflare Worker, D1 migrations, API and shared data contract
- Flagsmith feature flags: `agent_qa`, `role_tracks`, `guided_sessions`
- UI implementation follows the design rules below

## UI rules

- Minimalist and flat: simple 2D shapes, solid colors, generous whitespace, clear grid alignment.
- Familiar, readable screens with short explanations and clear action labels.
- Use icons sparingly and only when they help recognition; avoid decorative icon clusters.
- Keep pages focused. Avoid dense dashboards, walls of text, novelty visuals, and unexplained jargon.
- Never expose system prompts, hidden instructions, raw model traces, or internal development scaffolding in product UI.
- Agent context is opt-in and minimized. The connected agent sends an approved gist and only task-relevant material, never the full workspace by default.
- Project gist fields must not be treated as private secrets storage.

## Run locally

1. Install Node.js and run `npm install`.
2. Create a local D1 database with `npx wrangler d1 create kt-console` and copy its ID into `wrangler.toml`.
3. Apply the migration locally: `npx wrangler d1 migrations apply kt-console --local`.
4. Start the app with `npm run dev`.

To use Cloud Flagsmith, set `FLAGSMITH_ENVIRONMENT_ID` in `wrangler.toml` to a **client-side environment key** from Flagsmith Cloud. Create the flags `agent_qa`, `role_tracks`, and `guided_sessions`. The UI uses safe disabled defaults if the key is empty.

Deploy the frontend and Worker together with `npm run deploy`. Create the D1 database remotely and apply migrations with `npx wrangler d1 migrations apply kt-console --remote` first.

## Current slice and limitations

The project create and join endpoints are working foundations. Authentication, owner authorization, secure invitation expiry/rotation, agent device authorization, owner settings, and learning-material creation still need implementation before real teams should use those flows. The UI currently uses a sample owner identity. Do not put secrets or sensitive workspace content in project gists.
