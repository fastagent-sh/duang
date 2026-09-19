# Contributing to duang

Use GitHub Flow: one focused branch, one reviewed PR, one squash commit on `main`.
All repository-facing text is English. Product scope comes from [README.md](README.md),
[design](docs/design.md), [interactions](docs/interaction.md) and [architecture](docs/architecture.md).
A working implementation is not evidence that all of a milestone's user workflows are accepted.

## Set up and verify locally

Use Node 24 and npm. duang currently depends on `file:../fastagent`; a standalone duang checkout
cannot build that dependency. CI uses sibling checkouts and pins FastAgent in
[.github/fastagent-revision](.github/fastagent-revision), rather than following a moving branch.

For fresh sibling checkouts:

```bash
git clone https://github.com/fastagent-sh/fastagent.git fastagent
git clone https://github.com/fastagent-sh/duang.git duang
cd duang
read -r revision < .github/fastagent-revision
git -C ../fastagent checkout --detach "$revision"
(cd ../fastagent && npm ci && npm run build)
npm ci
npm test
npm run build
npm run dev
```

`npm run build` includes TypeScript checking and the Electron main/preload/renderer builds.
Do not detach, reset or overwrite an existing sibling checkout containing someone else's work;
use a separate checkout/worktree instead. A FastAgent API change must land upstream first, then
update the pinned revision in the same duang PR that consumes it.

Verify locally before pushing. CI is confirmation, not the first debugging environment.

## Issues and milestones

Use the Bug, Feature or Task form. The forms set the GitHub issue type and initial label. With
push access, CLI-created issues must set them explicitly because `gh` does not consume YAML forms:

```bash
gh issue create --type Bug --label bug --title 'bug: <observable failure>' --body '<reproduction>'
gh issue create --type Feature --label enhancement --title 'feat: <user outcome>' --body '<acceptance criteria>'
gh issue create --type Task --label chore --title 'task: <outcome>' --body '<scope and verification>'
```

- Link an existing milestone and related interaction/acceptance IDs instead of creating duplicates.
- `priority:P0` means a milestone blocker; `priority:P1` means planned work after blockers. These
  labels are planning order, not incident severity. Do not silently move work into Week 1.
- Assign the person doing the work when they pick it up; do not invent deadlines or assignees.
- Close an issue with actual verification evidence, not just a code diff or passing mocks.
- A PR's `Closes #N` closes the issue on merge, but does not copy its milestone or priority to the PR.

## Branch and PR loop

Branch prefixes follow FastAgent: `feature/` (`feat/` also accepted), `fix/`, `refactor/`, `docs/`,
`chore/`, `ci/`, `test/`. Never push directly to `main`.

```bash
git switch -c fix/<focused-change>
# Make and verify the change.
npm test && npm run build
git push -u origin HEAD
gh pr create --base main --assignee @me --milestone '<milestone of the issue>' \
  --body 'Closes #<issue>

<final behavior, verification, known limitations>'
```

Fill the PR sidebar before asking for review: assignee (yourself), intent label, and the same
milestone as the issue it closes when that issue has an open one — omit `--milestone` otherwise
instead of inventing one. `Closes #N` in the body populates Development; a PR that only does part of
an issue writes `Part of #N` and leaves Development empty rather than closing work that is not done.
Fix an existing PR with `gh pr edit <n> --add-assignee @me --add-label <label> --milestone <title>`.
Leave Projects alone; the repo does not use project boards. Drop `--assignee @me` if you lack push
access. Branch-prefix automation adds the PR's intent label; CODEOWNERS requests maintainers. An
unknown branch prefix needs a manual label. Automation and review routing take effect after these
files land on the default branch.

PR titles use `type(scope): summary`. The final PR title/body become the squash commit message:
explain final behavior, necessary rationale and known limitations, not intermediate attempts.
Keep unrelated refactors separate. Include issue links, tests actually run, tests not run, and
sanitized screenshots for visible UI changes. Read review bodies, conversation comments and inline
threads; address every item before resolving its thread.

## Product-specific verification

`Desktop checks` runs tests, a production build and `node tests/smoke.mjs` on macOS with Node 24 —
the smoke launches a real Electron window, so it runs on the only platform duang supports. The smoke
drives the real Electron/preload/IPC/FastAgent stack with synthetic credentials and fake HTTP; run
`npm run test:smoke` locally to build and run it. It is not an installer/signing check and claims
neither Windows/Linux support nor real-provider/OAuth validation nor full Week 1 acceptance. The
[release gate](https://github.com/fastagent-sh/duang/issues/16) still requires workflow evidence.

For changes to local agent workflows, verify the relevant cases:

- the displayed model, actual conversation model and credential source agree, including history
  whose provider differs from the agent default;
- drafts, output, errors and queues remain attached to their conversation across navigation;
- a background run remains observable/stoppable, and failed operations preserve its control path;
- registry/scaffold writes do not destroy existing data, and rejection is not shown as delivery;
- Enter, Shift+Enter, IME input, Escape priority and focus restoration work in Electron;
- history/reconnection reports missing runtime fields honestly and does not replay accepted work.

Automated tests must use isolated fixtures and fake model responses. Never stage a developer's
`auth.json`, OAuth refresh token, model key or private transcript in Actions, test artifacts or
issue/PR evidence. Real-provider and proxy checks require separate, explicit authorization and
must be reported separately from mocked checks. No cloud or paid live-test workflow is configured.

## Review and merge policy

A maintainer makes the merge decision. Green CI means **ready for review/merge**, not permission
for a coding agent to merge. External-contributor PRs need maintainer review; a second maintainer
review is recommended for credential handling, IPC/security boundaries, persistence and workflows.

Repository settings allow squash merges only, use the PR title/body, delete merged branches, and
allow updating a PR branch. Auto-merge and workflow approval of PRs are disabled. Do not force-push
or delete `main`; require resolved review conversations and a green `Desktop checks` before merging.

**Current enforcement limitation:** GitHub returns HTTP 403 for branch protection/rulesets on this
private repository under the current plan. The PR/check/review rules above are maintainer policy,
not server-enforced protection yet; [issue #17](https://github.com/fastagent-sh/duang/issues/17)
tracks enabling it. Do not make the repository public or buy/enable paid features just to bypass
this limitation. The intended protection settings are versioned in
[.github/main-protection.json](.github/main-protection.json). Once the repository plan supports
protection and `Desktop checks` exists, a repository admin can apply and verify them:

```bash
gh api --method PUT repos/fastagent-sh/duang/branches/main/protection \
  --input .github/main-protection.json
gh api repos/fastagent-sh/duang/branches/main/protection
```

After an explicitly authorized merge:

```bash
git switch main
git pull --ff-only
git branch -d <merged-branch>
git fetch --prune origin
```

## Dependencies, Actions and releases

- Actions are SHA-pinned. Default `GITHUB_TOKEN` permissions are read-only; the metadata-only
  labeler alone gets PR-write permission and must never check out or execute PR code.
- Dependabot checks GitHub Actions weekly. npm/FastAgent version updates remain ordinary reviewed
  PRs while the linked sibling dependency prevents a standalone updater/install workflow. Keep
  `package.json`, the lockfile and the FastAgent pin consistent when applicable.
- Vulnerability alerts are enabled. Review alerts and fix dependencies manually as needed; do not
  assume automatic npm fixes or advisory/code scanning cover every dependency.
- CodeQL is unavailable without this private repository's Advanced Security entitlement. CodeQL
  and secret scanning have not been enabled, and no paid security feature was activated. Never
  treat their absence as a clean security result.
- No release/publish workflow is configured. duang is an Electron application, not FastAgent's npm
  package; signing, notarization, updater distribution and cloud deployment need separate decisions.
- Do not change visibility, collaborators, licensing or billing as part of ordinary code work.

Keep durable guidance here, in `AGENTS.md`, or in `docs/`. Do not commit temporary plans, handoffs,
execution logs or machine-specific state.
