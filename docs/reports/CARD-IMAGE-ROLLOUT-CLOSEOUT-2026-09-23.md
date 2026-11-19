# Pack One card-image rollout closeout — 2026-09-23

## Scope

This release normalized all served Pack One card images to deterministic main/base official art while preserving puzzle identity, gameplay evidence, scores, probabilities, provenance, and historical results.

The original visible regressions included Enduring Innocence and Abhorrent Oculus in Powered Cube Practice. The resolver and release were generalized across every served environment rather than patching those cards individually.

## Reviewed fixes

- PR #412 introduced deterministic Pack One-wide main-art normalization.
- PR #438 handled terminal resolver edge cases, including the HBG rebalanced Adventure identity and unavoidable original/only special-frame printings.
- PR #442 made backend image propagation paged and resumable after the prior whole-environment request exceeded the authenticated import timeout.
- PR #447 changed generated source publication to a protected-branch-compatible pull-request flow and added a recovery publication workflow.

## Successful production evidence

The guarded release was pinned to reviewed code revision `85637c0e7a6c0464cc419630e26aae8ccb9dda8d`.

- Development deploy run 35947214151: success.
- Production deploy run 35947328537: success.
- Pack One image refresh run 35947567070:
  - replay hydration: success;
  - deterministic main-art normalization: success;
  - full tests: success;
  - production dataset audit: success;
  - diagnostics upload: success;
  - marked backend revision verification: success;
  - normalized R2 replay publication: success;
  - development backend image refresh: success, 2026-09-24 02:37:36Z–03:00:42Z;
  - development gameplay verification: success;
  - production backend image refresh: success, 2026-09-24 03:01:11Z–03:24:48Z;
  - production gameplay verification: success, 2026-09-24 03:24:48Z–03:25:09Z.

The paged backend path therefore cleared the original timeout in both development and production.

## Final publication failure and recovery

After production gameplay verification passed, the workflow created the refreshed corpus commit locally and rebased it successfully. GitHub then rejected the attempted direct `main` push with GH013 because repository rules require:

- changes through a pull request; and
- both required status checks.

No live rollback was required. R2, development backend metadata, production backend metadata, and production gameplay verification had already succeeded.

PR #447 first corrected the publication contract away from direct `main` pushes and added `.github/workflows/publish-card-image-source.yml` to recover checked-in source after successful live propagation without rerunning production backend work. The first recovery run regenerated and validated the corpus and successfully pushed `automation/card-image-source-35952933287`, but GitHub rejected its `gh pr create` call because repository settings do not permit GitHub Actions to create pull requests. The connected GitHub app opened that validated branch as PR #452. PR #454 then codified the actual repository contract: workflows push a generated branch and record the handoff; an authorized operator/app opens the protected-main PR.

## Operational lesson

Treat live propagation and repository publication as separate release boundaries. The correct recovery for a protected-branch failure after successful production verification is to regenerate from the already-normalized R2 state, push a generated branch, and have an authorized operator/app open it through the normal PR/checks path—not to rerun the production backend mutation.

## Final repository closeout

Recovery validation succeeded and pushed branch `automation/card-image-source-35952933287`. The connected GitHub app opened that validated branch as PR #452 after GitHub Actions was denied permission to create the PR itself.

PR #452 passed the required test and E2E checks and merged the recovered normalized source to `main` as `28713eb863f6a948345e37010ccfc1ddd09e3678`.

PR #454 then passed the required test and E2E checks and merged as `3c3464f86f05edde6395045107f5b97ab8e5bd83`. The permanent workflow contract is now:

1. finish live normalization, backend propagation, and gameplay verification;
2. commit/rebase the explicit checked-in card-image files;
3. push a generated automation branch;
4. record that branch as the workflow handoff;
5. have an authorized operator/app open the protected-main PR;
6. merge only after normal required checks pass.

At this point the live production state and the checked-in source of truth are aligned, and the release is closed.
