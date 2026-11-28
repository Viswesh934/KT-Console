# KT Console agent workflow

When a project owner asks to prepare KT material for the connected workspace, use the `kt-console` MCP tools. Do not ask them to fill out a project setup form or manually supply details that can be learned from the workspace.

## Prepare a project

1. Inspect only relevant repository context such as its README, package manifests, architecture docs, entry points, and selected implementation files. Never send the whole workspace to KT Console.
2. Write a concise project gist that explains purpose, architecture, major flows, and where to begin. Remove credentials, personal data, and unrelated internal details.
3. Call `create_project` with the inferred project name, approved gist, and a short source label.
4. Add a practical guide and edge cases. Tailor materials for junior, mid-level, and senior developers, using `all` when a concept applies to everyone.
5. Add a quiz with clear, project-grounded questions, plausible options, a correct option index, and a short explanation. Add a thinking session that asks the learner to reason through a realistic change.
6. Call `publish_project` only after the required guide/edge-case material and quiz have been added.

The project is ready when it is published. Learners should be able to open it without typing project details or seeing internal preparation prompts.

## Privacy and product presentation

- Only send a project gist and material relevant to the learning task. Do not upload full repositories, raw conversation context, secrets, or unrelated workspace files.
- Do not expose system prompts, hidden instructions, scratch notes, raw model traces, or tool scaffolding in learner-facing material.
- Write in direct, plain language. Prefer concrete file paths and examples; label uncertain inferences clearly.
- Use the Minimalist & Flat interface rules in the README: clear grid, whitespace, restrained solid colors, and sparse purposeful icons.
- If the workspace does not contain enough evidence to describe a claim accurately, omit it or mark the uncertainty. Ask the owner only when a required decision cannot be inferred safely.

## Scores

Use `get_project_scores` when the owner asks to review progress. Treat learner IDs as pseudonymous, and do not attempt to identify people behind them. Claim codes and named team identities are a later feature.
