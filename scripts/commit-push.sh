#!/usr/bin/env bash
# commit-push.sh "<commit message>" <path>...
# 워크플로 공통 커밋·푸시. cron 지연으로 여러 워크플로가 몰려 실행되면 push가 "fetch first"로
# 거절된다(2026-09-24 polarization, 2026-09-27 daily-summary). 거절 시 origin/main 위로 rebase 후 재시도.
# 충돌은 재생성 가능한 index 파일에서만 허용하고, rebase 뒤에는 index를 다시 빌드해 다른 워크플로의 변경을 반영한다.
set -euo pipefail

msg="$1"
shift

git config user.name "eco-intelligence-bot"
git config user.email "actions@users.noreply.github.com"

git add "$@"
if git diff --cached --quiet; then
  echo "[commit-push] nothing to commit"
  exit 0
fi
git commit -q -m "$msg"

rebuild_indexes() {
  local changed
  changed=$(git diff --name-only HEAD~1 HEAD)
  if grep -qx "data/index.json" <<<"$changed"; then node scripts/build-index.mjs; git add data/index.json; fi
  if grep -qx "data/summary/index.json" <<<"$changed"; then node scripts/build-summary-index.mjs; git add data/summary/index.json; fi
  git diff --cached --quiet || git commit -q --amend --no-edit
}

for attempt in 1 2 3 4 5; do
  if git push -q; then
    echo "[commit-push] pushed (attempt $attempt)"
    exit 0
  fi
  echo "[commit-push] push rejected (attempt $attempt), rebasing onto origin/main"
  git fetch -q origin main
  if ! git rebase -q origin/main; then
    for f in $(git diff --name-only --diff-filter=U); do
      case "$f" in
        data/index.json) node scripts/build-index.mjs ;;
        data/summary/index.json) node scripts/build-summary-index.mjs ;;
        *)
          echo "::error::rebase conflict in $f"
          git rebase --abort
          exit 1
          ;;
      esac
      git add "$f"
    done
    GIT_EDITOR=true git rebase --continue
  fi
  rebuild_indexes
  sleep $((attempt * 5))
done

echo "::error::push failed after 5 attempts"
exit 1
