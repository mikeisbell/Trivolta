# INSTRUCTIONS_CODE_REVIEW.md

## Task

Perform a full code analysis of the Trivolta mobile app and Supabase backend. Read every source file and produce a written report of all issues found — bugs, errors, redundancy, poorly implemented patterns, type safety gaps, performance problems, and anything that would concern a senior engineer reviewing this codebase for beta readiness.

This is a read-and-report task. Do NOT fix anything. Write a report file. Mac Claude will review the findings and decide what to fix, then write a separate INSTRUCTIONS file for the fixes.

---

## Verifiable Objective

- [ ] Every source file in `mobile/app/`, `mobile/lib/`, and `supabase/functions/` has been read
- [ ] `TRIVOLTA_CODE_REVIEW.md` written to `/Users/mizzy/Developer/Trivolta/TRIVOLTA_CODE_REVIEW.md`
- [ ] The report covers all categories listed in the Report Format section below
- [ ] No source files were modified — this is read-only
- [ ] `npx tsc --noEmit` run and output included in the report

---

## Constraints

- Do NOT modify any source file
- Do NOT run any Maestro tests
- Do NOT commit anything
- Read every file before writing the report — do not skim

---

## Files to Read

### Mobile screens
- `mobile/app/_layout.tsx`
- `mobile/app/auth.tsx`
- `mobile/app/question.tsx`
- `mobile/app/results.tsx`
- `mobile/app/custom-category.tsx`
- `mobile/app/(tabs)/_layout.tsx`
- `mobile/app/(tabs)/index.tsx`
- `mobile/app/(tabs)/play.tsx`
- `mobile/app/(tabs)/profile.tsx`
- `mobile/app/(tabs)/leaderboard.tsx`
- `mobile/app/lobby/create.tsx`
- `mobile/app/lobby/join.tsx`
- `mobile/app/lobby/waiting.tsx`
- `mobile/app/lobby/game.tsx`
- `mobile/app/lobby/results.tsx`

### Mobile lib
- `mobile/lib/api.ts`
- `mobile/lib/types.ts`
- `mobile/lib/auth.tsx`
- `mobile/lib/supabase.ts`
- `mobile/lib/theme.ts`
- `mobile/lib/gameHistory.ts`

### Supabase
- `supabase/functions/solo-question/index.ts`
- `supabase/functions/generate-questions/index.ts`
- `supabase/functions/create-lobby/index.ts`
- `supabase/functions/join-lobby/index.ts`
- `supabase/functions/daily-challenge/index.ts`
- `supabase/migrations/20240101000000_initial_schema.sql`
- All subsequent migration files

### Config
- `mobile/app.json`
- `mobile/package.json`

---

## Report Format

Write `TRIVOLTA_CODE_REVIEW.md` with the following sections. Each issue must include: file path, line reference (approximate), description of the problem, and severity (Critical / High / Medium / Low).

**Severity definitions:**
- **Critical** — will cause crashes, data loss, or security vulnerabilities in production
- **High** — will cause wrong behaviour, silent failures, or bad UX for beta testers
- **Medium** — code smell, redundancy, or pattern that will cause maintenance problems
- **Low** — minor style issues, dead code, or trivial improvements

### Section 1 — TypeScript & Type Safety
Type assertions (`as any`), missing types, unsafe casts, implicit `any`, missing null checks that could crash at runtime.

### Section 2 — API & Data Layer
Supabase query issues, missing error handling, N+1 queries, incorrect RLS assumptions, missing `await`, fire-and-forget without error logging, data shape mismatches between API responses and TypeScript types.

### Section 3 — Edge Functions
Error handling gaps, missing input validation, Anthropic API error handling, retry logic issues, CORS handling correctness, environment variable access without fallbacks.

### Section 4 — React & State Management
Missing `useCallback`/`useMemo` dependencies, stale closure bugs, missing cleanup in `useEffect`, memory leaks (subscriptions not unsubscribed, timers not cleared), incorrect dependency arrays, unnecessary re-renders.

### Section 5 — Navigation & Routing
Incorrect route params, missing param validation, navigation to non-existent routes, back navigation that could break the stack.

### Section 6 — Game Logic
Timer bugs, score calculation issues, streak logic errors, edge cases in the question loop (e.g. what happens at exactly Q10), off-by-one errors.

### Section 7 — Security
API keys in wrong places, RLS policies that are too permissive, unauthenticated access to authenticated routes, missing auth checks in Edge Functions.

### Section 8 — Redundancy & Dead Code
Duplicate logic across files, unused imports, unused state variables, styles defined but never referenced, functions that could be shared.

### Section 9 — Database & Schema
Schema design issues, missing indexes, RLS gaps, migration ordering issues, constraints that are missing.

### Section 10 — Summary
Total issue count by severity. Top 5 issues to fix before beta. Overall assessment.

---

## Verification

```bash
# Run TypeScript check and capture output
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit 2>&1

# Confirm report was written
ls -la /Users/mizzy/Developer/Trivolta/TRIVOLTA_CODE_REVIEW.md
```

Write the report. Do not modify any source files. Do not commit.
