#!/usr/bin/env bash
# Publish this repository to GitHub and create a release without `gh`.
#
# Usage:
#   GITHUB_TOKEN=... bash scripts/github-publish.sh [owner] [repo] [tag]
#   or run without GITHUB_TOKEN and enter it interactively (input is hidden).
#   TAG defaults to the version in package.json; the release body is taken
#   from the matching "## <tag>" section of CHANGELOG.md when present.
#
# Requires: git, curl, jq (jq is optional; the script degrades without it).
set -euo pipefail

OWNER="${1:-kanneiren}"
REPO="${2:-dsh-network-settings}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${3:-v$(node -p 'require("./package.json").version')}"
BRANCH="main"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  read -rsp "GitHub personal access token (repo + contents): " GITHUB_TOKEN
  echo
fi
export GITHUB_TOKEN

cd "$ROOT"
API="https://api.github.com"
AUTH="Authorization: token ${GITHUB_TOKEN}"
JSON_ACCEPT="Accept: application/vnd.github+json"

echo "==> Validating GitHub token"
USER_HTTP="$(curl -sS -o /tmp/dsh-gh-user.json -w '%{http_code}' -H "$AUTH" -H "$JSON_ACCEPT" "$API/user")"
if [[ "$USER_HTTP" != "200" ]]; then
  echo "GitHub token is invalid, expired, revoked, or lacks the repo scope. HTTP ${USER_HTTP}" >&2
  echo "Create a classic token with the 'repo' scope at:" >&2
  echo "  https://github.com/settings/tokens" >&2
  exit 1
fi
echo "Authenticated as $(grep -o '"login":"[^"]*"' /tmp/dsh-gh-user.json | head -1)"

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
CLEAN_URL="https://github.com/${OWNER}/${REPO}.git"
cleanup_remote() {
  git remote set-url origin "$CLEAN_URL" 2>/dev/null || true
}
trap cleanup_remote EXIT

git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${OWNER}/${REPO}.git"
git fetch origin --prune || true

REMOTE_AHEAD="$(git rev-list --left-right --count "$BRANCH"...origin/"$BRANCH" 2>/dev/null | awk '{print $2}')"
if [[ -n "$REMOTE_AHEAD" && "$REMOTE_AHEAD" != "0" ]]; then
  echo "Remote ${BRANCH} contains ${REMOTE_AHEAD} commit(s) not present locally."
  read -rp "Force push local ${BRANCH} to GitHub? [y/N] " FORCE
  if [[ "$FORCE" == "y" || "$FORCE" == "Y" ]]; then
    git push --force-with-lease origin "$BRANCH:$BRANCH"
  else
    echo "Aborted before push." >&2
    exit 1
  fi
else
  git push -u origin "$BRANCH:$BRANCH"
fi

echo "==> Creating release ${TAG}"
# Release body: the "## <tag>" section of CHANGELOG.md (JSON-escaped via
# node, which the script already depends on); fall back to generated notes.
RELEASE_BODY="$(awk -v tag="## ${TAG}" '$0 == tag {found=1; next} found && /^## / {exit} found {print}' "$ROOT/CHANGELOG.md" 2>/dev/null || true)"
if [[ -n "$RELEASE_BODY" ]]; then
  RELEASE_JSON="$(printf '%s' "$RELEASE_BODY" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.stringify({body:d})))')"
else
  RELEASE_JSON='{"generate_release_notes":true}'
fi

RELEASE_HTTP="$(curl -sS -o /tmp/dsh-gh-release.json -w '%{http_code}' -X POST -H "$AUTH" -H "$JSON_ACCEPT" \
  "$API/repos/${OWNER}/${REPO}/releases" \
  -d "{\"tag_name\":\"${TAG}\",\"name\":\"${TAG}\",\"target_commitish\":\"${BRANCH}\",${RELEASE_JSON:1:-1}}")"
if [[ "$RELEASE_HTTP" == "422" ]]; then
  # Release for this tag already exists (e.g. re-running the script):
  # update its body instead of failing.
  echo "==> Release ${TAG} already exists; updating its body"
  RELEASE_ID="$(curl -sS -H "$AUTH" -H "$JSON_ACCEPT" "$API/repos/${OWNER}/${REPO}/releases/tags/${TAG}" | grep -o '"id": *[0-9]*' | head -1 | grep -o '[0-9]*')"
  if [[ -n "$RELEASE_ID" ]]; then
    curl -sS -X PATCH -H "$AUTH" -H "$JSON_ACCEPT" \
      "$API/repos/${OWNER}/${REPO}/releases/${RELEASE_ID}" \
      -d "$RELEASE_JSON" >/dev/null
  fi
elif [[ "$RELEASE_HTTP" != "201" ]]; then
  echo "Release creation returned HTTP ${RELEASE_HTTP}" >&2
  exit 1
fi

echo
echo "Done: https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}"
