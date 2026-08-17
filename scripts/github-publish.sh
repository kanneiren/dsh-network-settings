#!/usr/bin/env bash
# Publish this repository to GitHub and create a release without `gh`.
#
# Usage:
#   GITHUB_TOKEN=... bash scripts/github-publish.sh
#   or run without GITHUB_TOKEN and enter it interactively (input is hidden).
#
# Requires: git, curl, jq (jq is optional; the script degrades without it).
set -euo pipefail

OWNER="${1:-kanneiren}"
REPO="${2:-dsh-network-settings}"
TAG="${3:-v0.1.0}"
BRANCH="main"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  read -rsp "GitHub personal access token (repo + contents): " GITHUB_TOKEN
  echo
fi
export GITHUB_TOKEN

cd "$ROOT"
API="https://api.github.com"
AUTH="Authorization: token ${GITHUB_TOKEN}"
JSON_ACCEPT="Accept: application/vnd.github+json"

echo "==> Checking repository ${OWNER}/${REPO}"
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -H "$AUTH" -H "$JSON_ACCEPT" "$API/repos/${OWNER}/${REPO}")"
if [[ "$STATUS" == "404" ]]; then
  echo "==> Creating public repository"
  curl -sS -X POST -H "$AUTH" -H "$JSON_ACCEPT" \
    "$API/user/repos" \
    -d "{\"name\":\"${REPO}\",\"description\":\"DSH Network Settings: Windows / WSL network path diagnostics and safe repair for DeepSeek Harness.\",\"homepage\":\"https://github.com/${OWNER}/${REPO}#readme\",\"public\":true,\"license_template\":\"mit\"}"
elif [[ "$STATUS" == "200" ]]; then
  echo "==> Repository already exists"
else
  echo "GitHub API returned HTTP ${STATUS}" >&2
  exit 1
fi

echo "==> Setting remote and pushing ${BRANCH}"
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${OWNER}/${REPO}.git"
git push -u origin "$BRANCH:$BRANCH"
git remote set-url origin "https://github.com/${OWNER}/${REPO}.git"

echo "==> Creating release ${TAG}"
curl -sS -X POST -H "$AUTH" -H "$JSON_ACCEPT" \
  "$API/repos/${OWNER}/${REPO}/releases" \
  -d "{\"tag_name\":\"${TAG}\",\"name\":\"${TAG}\",\"body\":\"Initial public release of dsh-network-settings.\",\"generate_release_notes\":true}"

echo
echo "Done: https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}"
