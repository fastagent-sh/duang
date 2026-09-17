# duang — Agent Guide

## Product and authority

A local-first Electron client for FastAgent agents, with cloud deployment planned later.
Agents are contacts backed by directories; conversations and history belong to FastAgent.

- `README.md`: positioning and milestone scope.
- `docs/design.md`: product objects, surfaces and flows.
- `docs/interaction.md`: interaction behavior and failure presentation.
- `docs/architecture.md`: process boundaries and state ownership.
- `CONTRIBUTING.md`: authoritative GitHub, verification, review and merge workflow.

Distinguish requirements, implemented behavior and verified acceptance. An open issue may ask for
verification of existing code, not a rewrite. Resolve conflicting product policies explicitly.

## Boundaries

- Main owns runtimes, filesystem access and credentials. The renderer uses a typed preload API;
  do not expose unrestricted filesystem, IPC or shell access or weaken context isolation/CSP.
- Use FastAgent's public contracts, not private engine imports or another copy of its session store.
- Agent defaults and historical conversation settings are different. Model display, the model that
  executes and provider authentication must agree for each conversation.
- Drafts/live presentation state must not become a second durable transcript. Keep state and late
  async results attached to their originating agent, conversation and subscription.
- Preserve data-integrity protections and original errors. Never turn corrupt/unreadable state into
  an empty list, hide failure as a fallback, or automatically replay accepted tool work.
- No real credentials, private sessions or project contents in tests, logs, commits or artifacts.
  Live provider calls and OAuth refresh tests need explicit authorization and isolated credentials.
- Keep Week 1 local. No placeholder cloud UI, agent editor, permission-prompt system, files/diffs or
  advanced session controls without the corresponding product requirement/milestone.

## Working and verification

Read the affected path and callers first. Prefer existing helpers, the standard library and native
Electron/Chromium behavior; avoid speculative layers. Separate refactoring from behavior changes.
Add the smallest regression that exposes the failure, including proving protective checks can fail
when their protection is removed.

FastAgent is a sibling `file:` dependency. CI pins its revision in `.github/fastagent-revision`;
follow `CONTRIBUTING.md` for fresh-checkout setup rather than modifying someone else's checkout.

```bash
npm test
npm run build
```

Verify relevant desktop interactions separately; mocked HTTP tests do not prove real OAuth or
proxy behavior. Update companion product docs and state limitations honestly.

## Collaboration

Use a focused prefixed branch and a PR, never a direct push to `main`. Preserve unrelated uncommitted
work; use an isolated worktree when necessary. Keep repository artifacts and GitHub discussion in
English. Link issues and provide actual evidence before closing acceptance criteria.

Read all review bodies, comments and inline threads, including paginated results. Resolve a thread
only after fixing/verifying it or explaining why it is declined. Report a green PR as ready and stop;
merge only when a maintainer explicitly authorizes it. See `CONTRIBUTING.md` for the current GitHub
plan's enforcement limitations; do not claim unenforced policy is branch protection.
