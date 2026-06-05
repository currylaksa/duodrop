#!/usr/bin/env bash
# setup-skills.sh - per-project Claude Code skills installer (macOS / Linux)
# Run from your PROJECT ROOT:  bash setup-skills.sh

set -u

echo "==> Project: $(pwd)"
mkdir -p .claude/skills

# 1. Karpathy behaviour layer at project root (ambient, loads every session)
if [ -f CLAUDE.md ] && grep -qi "karpathy\|Think Before Coding" CLAUDE.md; then
  echo "==> CLAUDE.md guidelines already present, skipping"
else
  echo "==> Appending Karpathy CLAUDE.md"
  curl -fsSL https://raw.githubusercontent.com/forrestchang/andrej-karpathy-skills/main/CLAUDE.md >> CLAUDE.md
fi

# 2. Clone sources to a temp dir (auto-cleaned on exit)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "==> Cloning skill repos..."
git clone --depth 1 https://github.com/mattpocock/skills "$TMP/mp"         || { echo "clone failed: mattpocock"; exit 1; }
git clone --depth 1 https://github.com/anthropics/skills  "$TMP/anthropic"  || { echo "clone failed: anthropic";  exit 1; }

# 3. Copy a skill folder by name (any sub-path); optional 3rd arg renames it
copy_skill () {
  repo="$1"; name="$2"; dest="${3:-$2}"
  src="$(find "$repo" -type d -name "$name" 2>/dev/null | head -n 1)"
  if [ -n "$src" ]; then
    rm -rf ".claude/skills/$dest"
    cp -R "$src" ".claude/skills/$dest"
    echo "   ok  /$dest"
  else
    echo "   --  $name not found (skipped)"
  fi
}

echo "==> Installing skills..."
copy_skill "$TMP/mp" grill-me grill-with-docs
copy_skill "$TMP/mp" design-an-interface
copy_skill "$TMP/mp" tdd
copy_skill "$TMP/mp" handoff
copy_skill "$TMP/mp" request-refactor-plan
copy_skill "$TMP/mp" write-a-skill
copy_skill "$TMP/anthropic" frontend-design
copy_skill "$TMP/anthropic" theme-factory
copy_skill "$TMP/anthropic" web-artifacts-builder
copy_skill "$TMP/anthropic" webapp-testing

# 4. Keep the rename consistent inside the SKILL.md (portable in-place edit)
SK=".claude/skills/grill-with-docs/SKILL.md"
if [ -f "$SK" ]; then
  sed 's/^name:.*/name: grill-with-docs/' "$SK" > "$SK.tmp" && mv "$SK.tmp" "$SK"
  echo "==> Set skill name -> grill-with-docs"
fi

# 5. Report
echo "==> Done. Skills in .claude/skills:"
ls -1 .claude/skills
echo
echo "Next: launch 'claude' in this folder, type '/' and pick e.g. /grill-with-docs"
