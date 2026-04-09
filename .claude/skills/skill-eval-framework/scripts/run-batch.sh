#!/usr/bin/env bash
# run-batch.sh — Batch runner: validate all TOON skills in a directory
# Usage: ./run-batch.sh [skills-root-directory]
# Default: .claude/skills/
# Output: JSON report to stdout, summary table to stderr
# Exit 0 = all pass, 1 = any fail

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SKILLS_ROOT="${1:-$PROJECT_ROOT/.claude/skills}"
RUN_EVAL="$SCRIPT_DIR/run-eval.sh"

# Skills to skip (not TOON NIP skills)
SKIP_PATTERNS="skill-creator|playwright-cli|rfc-|skill-eval-framework|shadcn"

TOTAL=0
PASSED_TOTAL=0
FAILED_TOTAL=0
RESULTS_JSON="["
FIRST=true

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "TOON Skill Batch Validation Report" >&2
echo "===================================" >&2
echo "Date: $TIMESTAMP" >&2
echo "Skills root: $SKILLS_ROOT" >&2
echo "" >&2

# Discover skills with evals/evals.json
for EVALS_FILE in "$SKILLS_ROOT"/*/evals/evals.json; do
  [ -f "$EVALS_FILE" ] || continue

  SKILL_DIR=$(dirname "$(dirname "$EVALS_FILE")")
  SKILL_NAME=$(basename "$SKILL_DIR")

  # Apply filter
  if echo "$SKILL_NAME" | grep -qE "^($SKIP_PATTERNS)"; then
    echo "  SKIP: $SKILL_NAME (filtered)" >&2
    continue
  fi

  # Print header before first skill
  if [ "$TOTAL" -eq 0 ]; then
    printf "  %-28s %-6s %-6s %-6s %-6s %-6s %-6s %-6s %-6s\n" \
      "Skill" "Struct" "Write" "Fee" "Format" "Social" "Trigger" "Evals" "Overall" >&2
    printf "  %-28s %-6s %-6s %-6s %-6s %-6s %-6s %-6s %-6s\n" \
      "----------------------------" "------" "------" "------" "------" "------" "------" "------" "------" >&2
  fi

  TOTAL=$((TOTAL + 1))

  # Run eval and capture output (|| true prevents set -e from aborting on failure)
  EVAL_OUTPUT=$(bash "$RUN_EVAL" "$SKILL_DIR" 2>&1 || true)

  # Parse classification from output
  CLASSIFICATION=$(echo "$EVAL_OUTPUT" | grep -o 'Classification: [a-z-]*' | head -1 | sed 's/Classification: //' || echo "unknown")

  # Parse individual assertion results
  parse_assertion() {
    local ASSERTION_NAME="$1"
    if echo "$EVAL_OUTPUT" | grep -q "PASS:.*$ASSERTION_NAME"; then
      echo "PASS"
    elif echo "$EVAL_OUTPUT" | grep -q "FAIL:.*$ASSERTION_NAME"; then
      echo "FAIL"
    elif echo "$EVAL_OUTPUT" | grep -q "SKIP:.*$ASSERTION_NAME"; then
      echo "N/A"
    else
      echo "N/A"
    fi
  }

  WRITE_RESULT=$(parse_assertion "toon-write-check")
  FEE_RESULT=$(parse_assertion "toon-fee-check")
  FORMAT_RESULT=$(parse_assertion "toon-format-check")
  SOCIAL_RESULT=$(parse_assertion "social-context-check")
  TRIGGER_RESULT=$(parse_assertion "trigger-coverage")
  EVAL_RESULT=$(parse_assertion "eval-completeness")

  # Determine structural pass
  if echo "$EVAL_OUTPUT" | grep -q "PASS: Structural validation passed"; then
    STRUCT_RESULT="PASS"
  else
    STRUCT_RESULT="FAIL"
  fi

  # Determine overall
  if echo "$EVAL_OUTPUT" | grep -q "Status: PASS"; then
    OVERALL="PASS"
    PASSED_TOTAL=$((PASSED_TOTAL + 1))
  else
    OVERALL="FAIL"
    FAILED_TOTAL=$((FAILED_TOTAL + 1))
  fi

  # Build JSON entry using node for safe serialization (prevents injection via special chars in directory names)
  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    RESULTS_JSON="$RESULTS_JSON,"
  fi

  JSON_ENTRY=$(node -e "
    console.log(JSON.stringify({
      skill_name: process.argv[1],
      structural_pass: process.argv[2] === 'PASS',
      classification: process.argv[3],
      toon_compliance: {
        'toon-write-check': process.argv[4],
        'toon-fee-check': process.argv[5],
        'toon-format-check': process.argv[6],
        'social-context-check': process.argv[7],
        'trigger-coverage': process.argv[8],
        'eval-completeness': process.argv[9]
      },
      overall: process.argv[10]
    }, null, 4));
  " "$SKILL_NAME" "$STRUCT_RESULT" "$CLASSIFICATION" \
    "$WRITE_RESULT" "$FEE_RESULT" "$FORMAT_RESULT" \
    "$SOCIAL_RESULT" "$TRIGGER_RESULT" "$EVAL_RESULT" "$OVERALL")

  RESULTS_JSON="$RESULTS_JSON
    $JSON_ENTRY"

  # Print summary line to stderr
  printf "  %-28s %-6s %-6s %-6s %-6s %-6s %-6s %-6s %-6s\n" \
    "$SKILL_NAME" "$STRUCT_RESULT" "$WRITE_RESULT" "$FEE_RESULT" "$FORMAT_RESULT" "$SOCIAL_RESULT" "$TRIGGER_RESULT" "$EVAL_RESULT" "$OVERALL" >&2

done

RESULTS_JSON="$RESULTS_JSON
  ]"

echo "" >&2
echo "Skills: $TOTAL discovered, $PASSED_TOTAL passed, $FAILED_TOTAL failed" >&2

# Output JSON report to stdout
cat <<EOF
{
  "timestamp": "$TIMESTAMP",
  "skills_discovered": $TOTAL,
  "skills_passed": $PASSED_TOTAL,
  "skills_failed": $FAILED_TOTAL,
  "results": $RESULTS_JSON
}
EOF

if [ "$FAILED_TOTAL" -gt 0 ]; then
  exit 1
else
  exit 0
fi
