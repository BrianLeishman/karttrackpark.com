---
name: creating-github-issues
description: Use when creating GitHub issues, making new issues, filing bugs, requesting features, or before running `gh issue create`. Triggers on "new issue", "create issue", "file issue", "gh issue", "open issue". Ensures proper research, labels, and structured descriptions.
---

# Creating GitHub Issues

## Overview

Every GitHub issue created in this repo must be fully configured with research and labels. This skill triggers automatically whenever creating an issue.

## Mandatory Workflow

### Step 1: Research the Codebase

Before writing the issue, use the Explore agent or search tools to understand:

- Where relevant code lives (file paths, functions, components)
- How similar functionality is currently implemented
- Database tables/keys, API endpoints, or UI components involved
- Existing patterns that should be followed

**Include in the issue:**
- Specific file paths and line numbers
- Code snippets showing current implementation
- DynamoDB key schema details if relevant
- References to similar existing code as examples

**Why:** Issues with research reduce back-and-forth questions and give implementers a head start.

### Step 2: Create the Issue

Use `gh issue create` with a well-structured body:

```bash
gh issue create --title "Brief descriptive title" --body "$(cat <<'EOF'
## Summary
<1-3 sentences describing what needs to be done>

## Current State
<What exists now, with file paths and code references>

## Proposed Changes
<What should change, with specific details>

## Technical Notes
<File paths, DynamoDB keys, API endpoints, code snippets>

## Acceptance Criteria
- [ ] Specific testable requirement
- [ ] Another requirement
EOF
)"
```

### Step 3: Add Labels

Apply appropriate labels:

```bash
gh issue edit <number> --add-label "enhancement"
```

**Required label categories:**

1. **Type** (pick one):
   - `enhancement` - New feature or improvement
   - `bug` - Something isn't working

2. **Area labels** — create these if they don't exist yet:
   - `frontend` - TypeScript, HTML, SCSS, Hugo templates
   - `backend` - Go code, Lambda, API handlers
   - `database` - DynamoDB schema, keys, queries
   - `infra` - AWS, deployment, CI/CD

**Area label rules:**
- Apply area label(s) based on where the work primarily happens
- Multiple area labels OK if issue spans areas
- If creating a new label, use: `gh label create "labelname" --color "<hex>"`

## Field Selection Guidelines

### Priority Assessment

When describing issues, include a priority suggestion in the title or body:

- **Critical** - Production broken, data loss, blocking issue
- **High** - Important bug fix, urgent feature (most bugs default here)
- **Medium** - Standard feature work (most enhancements default here)
- **Low** - Nice to have, can wait

**Default guidance:** Bugs default to High unless trivial. Enhancements default to Medium unless urgent.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Create issue without researching code first | Use Explore agent to find relevant files |
| Generic issue description | Include specific file paths, line numbers, code snippets |
| Forget area labels | Always tag frontend/backend/database/infra |
| Default all issues to Medium priority | Bugs should default to High |
| Skip DynamoDB key details for data issues | Include PK/SK patterns from `go/dynamo/keys.go` |
