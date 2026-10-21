---
name: ship
description: Check, commit, push the current feature branch and open a GitHub PR into main.
disable-model-invocation: true
---

Ship the current work as a PR into `main`. Optional PR title/notes: $ARGUMENTS

1. If on `main`, stop and ask for a feature branch name (features use names like `Study-Cards`).
2. If `public/style.css` changed, run `npm run build:dark`.
3. Run `npm test` and `npm run lint`. If either has errors, fix or report — do not ship.
4. Review `git status` / `git diff`; never commit `.env`. Commit with a short plain-English message describing what changed for users (match recent `git log` style).
5. `git push -u origin <branch>`.
6. Open the PR: `gh pr create --base main --fill` (or with a title/body from $ARGUMENTS). If `gh` is not installed, give the user the compare URL instead: `https://github.com/Miche1225/hcilearn-platform/compare/main...<branch>?expand=1`.
7. Report the PR link.
