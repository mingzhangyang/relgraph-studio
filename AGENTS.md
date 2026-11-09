# Repository development and pull-request rules

These rules apply to all agents and contributors working on this repository.

## Non-stacked pull requests: mandatory

**Never stack pull requests in this repository.** Every new PR must target `main`, and its working branch must start from the current `main`, not from another feature branch or an unmerged PR.

1. Before coding, fetch the current `main` SHA, inspect open PRs, read repository instructions, and start a fresh branch from that `main` SHA.
2. Before opening a PR, refresh `main` and check the branch ancestry and the complete diff against `main`. Verify that the PR **base is `main`**, not a feature branch. If `main` moved, reconcile the new changes without dropping reviewed fixes.
3. If feature B requires feature A, first complete/merge A into `main` and **verify A's actual files and behavior are present on `main`**; only then create B from the updated `main`. If multiple tightly related changes need to land together, use **one PR with distinct commits**, not a stack.
4. Before merge, inspect the PR's actual `base.ref`, `head.sha`, ancestry, changed files, reviews and validation evidence. Do not treat a green or “Merged” label as evidence that code reached `main`.
5. After merge, fetch the new `main` SHA and compare the expected changed files/behavior against the reviewed tree; report any missing or overwritten changes immediately.
6. Do not silently rebase away review fixes or force-push another contributor's work. Preserve complete reviewed changes and document reconciliation explicitly.

These rules exist because PR #23 was merged into `feat/network-appearance` and PR #24 into `feat/network-layouts`, while neither feature reached `main`. PR #25 recovers both into **one direct-to-`main` PR**.

## Test and automation policy

- Prefer pure unit tests for math/state rules, a shared simulated-DOM harness for DOM integration, and real Chromium checks only for critical user flows; distinguish simulated DOM checks from real browser tests.
- Verify relevant commands locally, including typecheck, lint, unit/integration tests, production browser checks and native export checks when affected. State exactly which validations actually ran.
- **Do not add, dispatch or rerun GitHub Actions CI without the user's explicit authorization.** The absence of CI is not evidence that local checks passed.

## Scope and traceability

- Keep independent architecture changes separate from feature restorations or bug fixes.
- Link source PRs, tested commits and reproducible regression evidence in each PR.
