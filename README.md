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

## Local configuration

Install Node.js dependencies with `npm install`. Deployment and local Worker setup are deferred while the integration foundation is built. Keep credentials in your execution host or private local environment files; never commit them.

## Flagsmith client and MCP

KT Console uses the official Flagsmith JavaScript SDK through a small reusable adapter in `public/flagsmith-client.js`. Product code should call `flagsmithClient.hasFeature(...)`, `getValue(...)`, or `identify(...)` through that adapter instead of implementing flag evaluation itself. The browser receives only the Flagsmith **environment key**, which Flagsmith documents as the key used by its client SDK.

The workspace `.mcp.json` connects compatible agents to Flagsmith's hosted MCP endpoint at `https://mcp.flagsmith.com`. It uses the documented `Authorization: Api-Key ...` header and limits the exposed tools to project and feature-flag operations. Set `FLAGSMITH_API_TOKEN` in the environment of the agent host before starting/restarting that host. This must be a Flagsmith **Organization API key**, not the browser environment key. Do not put either real key in this repository or in chat. For an interactive MCP client that supports OAuth, Flagsmith also supports browser sign-in instead of an API key.

Required configuration names:

- `FLAGSMITH_ENVIRONMENT_ID`: client-side environment key used by the web SDK. The Worker returns it to the browser for SDK initialization; it is designed to be public.
- `FLAGSMITH_API_TOKEN`: organization API key used only by the local MCP client configuration. Keep it in the agent host's environment; never expose it to the browser or Worker API.

See the [Flagsmith MCP server guide](https://docs.flagsmith.com/integrating-with-flagsmith/mcp-server) for authentication and supported tools. In the connected agent, a low-impact first check is to list accessible organizations, projects, environments, and features.

The `.dev.vars.example` file lists the expected names without credentials. `.dev.vars` is ignored by Git. The Flagsmith MCP connection reads `FLAGSMITH_API_TOKEN` from the agent host environment, which is separate from the Worker environment.

To initialize a Flagsmith Cloud project, create the `agent_qa`, `role_tracks`, and `guided_sessions` flags in the environment associated with `FLAGSMITH_ENVIRONMENT_ID`. Keep them disabled until the corresponding KT Console experience is ready. The app uses safe disabled defaults while the environment key is absent.

Run the adapter smoke check with `npm run check:flagsmith-client`. This exercises the reusable wrapper with a fake SDK; an authenticated cloud connection still needs your environment values and agent-host MCP authorization.

Deployment details are intentionally deferred for now.

## Current slice and limitations

The project create and join endpoints are working foundations. Authentication, owner authorization, secure invitation expiry/rotation, agent device authorization, owner settings, and learning-material creation still need implementation before real teams should use those flows. The UI currently uses a sample owner identity. Do not put secrets or sensitive workspace content in project gists.
