# KT Console

KT Console helps teams get a useful gist of a project and learn it through role-aware guides and practice. This first slice establishes the deployable product shell, project/team foundation, Cloudflare API and D1 schema, and Flagsmith connection.

## Product work split

### Person 1 — Agent authoring and project access

- KT Console MCP tools for project creation, material authoring, and publishing
- Owner score review through the MCP
- Later: team claim codes, membership, and owner-controlled agent Q&A
- Later: device-code agent authorization and revocation

### Person 2 — Learner experience and scoring

- Learner-facing published project list and project overview
- Guides and edge cases for junior, mid-level, and senior users
- Quizzes with server-side scoring and guided thinking sessions
- Individual score history and clear material source/context

### Shared foundation

- Cloudflare Worker, D1 migrations, API and shared data contract
- Flagsmith feature flags: `agent_qa`, `role_tracks`, `guided_sessions`, `quiz_feedback`
- UI implementation follows the design rules below

## Agent-led project preparation

Project owners do not fill in a setup form. Connect an agent using the workspace `.mcp.json`; the agent uses KT Console tools to create an unpublished project from an approved workspace gist, add guides/edge cases/thinking sessions/quizzes, then publish it for learners. The learner site only lists published projects and requires no setup input.

The KT Console MCP tools are:

- `create_project`: create an unpublished project from workspace context.
- `add_learning_material`: add a guide, edge case, thinking session, or quiz. Quiz JSON includes `questions` with `prompt`, `options`, `correctIndex`, and optional `explanation`.
- `publish_project`: publish after at least one guide/edge case and one quiz are present.
- `get_project_scores`: retrieve quiz scores grouped by anonymous learner IDs.

Run `npm run dev` for the local Worker/API after configuring its D1 database and migrations, then connect the agent through `.mcp.json`. Set a long random `KT_CONSOLE_MCP_TOKEN` in local `.env` (the MCP process reads it and Wrangler provides it to the local Worker). Choose either `.env` or `.dev.vars` for local Worker variables; if using `.dev.vars`, make the token available to the MCP host environment as well. In a deployed Worker, store the token as a secret binding. Set `KT_CONSOLE_API_URL` in the MCP host environment only when the API is not at `http://127.0.0.1:8787`.

Learner IDs are random browser-local IDs for this first slice, so repeat quiz attempts from the same browser are associated with one learner. Team claim codes and cross-device identities remain deferred; they will let owners map learner scores to actual teammates later.

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

The workspace `.mcp.json` has two separate MCP connections: `kt-console` for creating KT projects and materials, and Flagsmith's hosted server at `https://mcp.flagsmith.com` for feature-flag management. The Flagsmith entry uses its documented `Authorization: Api-Key ...` header and limits the exposed tools. Set `FLAGSMITH_API_TOKEN` in the environment of the agent host before starting/restarting that host. This must be a Flagsmith **Organization API key**, not the browser environment key. Do not put either real key in this repository or in chat. For an interactive MCP client that supports OAuth, Flagsmith also supports browser sign-in instead of an API key.

Required configuration names:

- `FLAGSMITH_ENVIRONMENT_ID`: client-side environment key used by the web SDK. The Worker returns it to the browser for SDK initialization; it is designed to be public.
- `FLAGSMITH_API_TOKEN`: organization API key used only by the local MCP client configuration. Keep it in the agent host's environment; never expose it to the browser or Worker API.

See the [Flagsmith MCP server guide](https://docs.flagsmith.com/integrating-with-flagsmith/mcp-server) for authentication and supported tools. In the connected agent, a low-impact first check is to list accessible organizations, projects, environments, and features.

The `.dev.vars.example` file lists the expected names without credentials. `.dev.vars` is ignored by Git. The Flagsmith MCP connection reads `FLAGSMITH_API_TOKEN` from the agent host environment, which is separate from the Worker environment.

To initialize a Flagsmith Cloud project, create the `agent_qa`, `role_tracks`, `guided_sessions`, and `quiz_feedback` flags in the environment associated with `FLAGSMITH_ENVIRONMENT_ID`. Keep them disabled until the corresponding KT Console experience is ready. The app uses safe disabled defaults while the environment key is absent.

Run `npm run check:flagsmith-client` to smoke-check the reusable wrapper with a fake SDK. Run `npm run check:flagsmith-cloud` to make a read-only request to the configured Flagsmith environment. It reports only the HTTP result and number of flags, not keys or flag values.

Deployment details are intentionally deferred for now.

## Current slice and limitations

Project creation and material authoring are agent-only MCP operations. Learners see only published projects, take quizzes without typing project context, and are scored under a random browser-local ID. `get_project_scores` returns those pseudonymous IDs to the project owner through the MCP. Claim codes and named team membership are deferred, so scores do not yet map across devices to named teammates. The local MCP token is shared by the MCP process and Worker; replace that with user/project identity and authorization before opening a deployment to multiple teams. Published project material is currently visible to visitors who can reach the learner site. Do not include private or sensitive workspace information in the project gist.
