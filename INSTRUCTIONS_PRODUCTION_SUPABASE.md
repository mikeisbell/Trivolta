# INSTRUCTIONS_PRODUCTION_SUPABASE.md

## Task

Stand up the production Supabase project for Trivolta and point the mobile app at it. This covers creating the hosted project, linking it to the local repo, applying all 5 migrations, setting Edge Function secrets, deploying all 5 Edge Functions, and updating `mobile/.env.local` to reference production. After this task, the iOS Simulator build connects to production end-to-end.

This task does NOT cover EAS Build, TestFlight, or any client-side build pipeline. Those belong in `INSTRUCTIONS_EAS_BUILD.md`.

## Prerequisite

`INSTRUCTIONS_LOCAL_NEW_KEYS.md` must be complete first. That file:
- Upgrades the Supabase CLI to current
- Migrates local dev to new API keys (`sb_publishable_*` / `sb_secret_*`)
- Patches all 5 Edge Functions for new-key compatibility
- Updates CLAUDE.md to reflect the new-key auth pattern
- Verifies the local Maestro suite still passes

If the local Maestro suite is not green on new keys, do NOT proceed with this task.

## Verifiable objective

- [ ] A new Supabase hosted project exists, named `trivolta-prod`, in region `us-west-1`
- [ ] The local repo is linked to the new project (`supabase/.temp/project-ref` matches)
- [ ] All 5 migrations applied to production (`supabase migration list --linked` shows Local AND Remote for all 5)
- [ ] Production project uses the new API key system (publishable + secret keys created; legacy `anon` and `service_role` disabled)
- [ ] Edge Function secret `ANTHROPIC_API_KEY` is set on production
- [ ] All 5 Edge Functions deployed with `--no-verify-jwt` and ACTIVE: `solo-question`, `generate-questions`, `create-lobby`, `join-lobby`, `daily-challenge`
- [ ] `mobile/.env.local` points at production with the publishable key (`sb_publishable_*`) — never the secret key
- [ ] Smoke test: a clean iOS Simulator build signs up a new user, plays a solo game, completes the daily challenge — all three rows appear in production tables

## Constraints

- Do NOT commit any secret to git. Publishable key goes in `mobile/.env.local` (gitignored). Anthropic key goes ONLY into Supabase Edge Function secrets via the CLI.
- Do NOT use legacy `anon` or `service_role` keys anywhere in production. Disable both during Step 1.
- Do NOT modify `supabase/.env.local`, `supabase/config.toml`, any migration file, any Edge Function source file, or any mobile source file beyond `mobile/.env.local` and `mobile/.env.example`. (Edge Function patches happen in `INSTRUCTIONS_LOCAL_NEW_KEYS.md`, not here.)
- Do NOT run `supabase db reset` against the linked production project. Use `supabase db push` only.
- Do NOT enable any auth provider beyond email/password.
- Do NOT touch `mobile/maestro/.env.maestro`.
- Do NOT change `app.json` or `package.json`.
- Do NOT deploy any Edge Function without `--no-verify-jwt`. Under the new key system, platform-level JWT verification is incompatible. Auth is enforced inside each function.

## Steps

### Step 1 — Create the production Supabase project (Mike, browser)

Claude Code does NOT do this step. Mike does it in browser:

1. Go to https://supabase.com/dashboard
2. Click "New project"
3. Organisation: personal org
4. Name: `trivolta-prod`
5. Database password: generate strong, save in 1Password (NOT in any repo file)
6. Region: `West US (North California)` — `us-west-1`
7. Pricing plan: Free tier
8. Wait ~2 minutes for provisioning
9. Settings → API Keys → **Publishable and secret API keys** tab. If no publishable key exists, click "Create new API keys"
10. Capture:
    - **Project Ref** (Settings → General → Reference ID)
    - **Project URL** (Settings → API → Project URL)
    - **Publishable key** (`sb_publishable_xxx`)
    - **Secret key** (`sb_secret_xxx` — save to 1Password)
11. Settings → API Keys → **Legacy anon, service_role API keys** tab. Disable both legacy keys.

Hand the four values to Claude Code.

### Step 2 — Link the local repo

```bash
cd /Users/mizzy/Developer/Trivolta
supabase login    # if not already logged in
supabase link --project-ref <PROJECT_REF>
```

Paste the database password when prompted.

```bash
cat supabase/.temp/project-ref
# must print the project ref
```

### Step 3 — Push migrations

```bash
cd /Users/mizzy/Developer/Trivolta
supabase db push
supabase migration list --linked
```

All 5 rows must show both Local and Remote timestamps.

### Step 4 — Set Edge Function secrets

`SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable value), and `SUPABASE_SERVICE_ROLE_KEY` (secret value) are auto-injected by the platform on deploy. Only `ANTHROPIC_API_KEY` is set manually.

Open `supabase/.env.local` in VS Code, copy the Anthropic key value, then:

```bash
cd /Users/mizzy/Developer/Trivolta
supabase secrets set ANTHROPIC_API_KEY=<paste-value>
supabase secrets list
```

Expect `ANTHROPIC_API_KEY` plus auto-injected `SUPABASE_*` entries.

### Step 5 — Deploy all 5 Edge Functions

```bash
cd /Users/mizzy/Developer/Trivolta
supabase functions deploy solo-question --no-verify-jwt
supabase functions deploy generate-questions --no-verify-jwt
supabase functions deploy create-lobby --no-verify-jwt
supabase functions deploy join-lobby --no-verify-jwt
supabase functions deploy daily-challenge --no-verify-jwt
supabase functions list
```

All 5 must show ACTIVE.

### Step 6 — Update `mobile/.env.local`

Open in VS Code (NOT terminal). Replace contents with:

```
EXPO_PUBLIC_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the-publishable-key-starting-with-sb_publishable_>
```

The variable name remains `EXPO_PUBLIC_SUPABASE_ANON_KEY` — backward compat with `mobile/lib/supabase.ts`. The value is the publishable key.

```bash
cd /Users/mizzy/Developer/Trivolta/mobile && git check-ignore .env.local
# expect: .env.local
```

### Step 7 — Update `mobile/.env.example`

Edit to:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_your_key_here
```

### Step 8 — Smoke test against production

```bash
cd /Users/mizzy/Developer/Trivolta/mobile
npx expo run:ios
```

In the Simulator:
1. Sign up: username `prodsmoketest`, email `prodsmoketest@trivolta.app`, any password
2. Tap a category — play a solo game through to results
3. Back to HomeScreen, tap the Daily Challenge card — play to completion
4. Sign out

Verify in production:

```bash
cd /Users/mizzy/Developer/Trivolta
supabase db remote --linked psql -c "select count(*) from public.profiles where username = 'prodsmoketest';"
# expect: 1
supabase db remote --linked psql -c "select count(*) from public.scores s join public.profiles p on p.id = s.user_id where p.username = 'prodsmoketest';"
# expect: 1
supabase db remote --linked psql -c "select count(*) from public.daily_challenge_completions dcc join public.profiles p on p.id = dcc.user_id where p.username = 'prodsmoketest';"
# expect: 1
```

If any is empty, do NOT report success. Investigate:

```bash
supabase functions logs solo-question
supabase functions logs generate-questions
supabase functions logs daily-challenge
```

### Step 9 — Update tracker

Edit `TRIVOLTA_TRACKER.md`. Phase 3 — flip from ⬜ to ✅:
- `Production Supabase project created — INSTRUCTIONS_PRODUCTION_SUPABASE.md`
- `Production environment variables set in mobile app`
- `Edge Functions deployed to production`

Under "INSTRUCTIONS Files Written", flip `INSTRUCTIONS_PRODUCTION_SUPABASE.md` from ⬜ to ✅.

### Step 10 — Commit

```bash
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > /tmp/trivolta_diff.txt
```

After Mac Claude review:

```bash
git add INSTRUCTIONS_PRODUCTION_SUPABASE.md TRIVOLTA_TRACKER.md mobile/.env.example
git commit -m "feat: production Supabase deployed — new sb_publishable/sb_secret keys, 5 Edge Functions live"
git push
git status
# neither mobile/.env.local nor supabase/.env.local may appear
```

## Verification

```bash
# 1. Project link
test -f /Users/mizzy/Developer/Trivolta/supabase/.temp/project-ref && cat /Users/mizzy/Developer/Trivolta/supabase/.temp/project-ref

# 2. All 5 migrations applied
cd /Users/mizzy/Developer/Trivolta && supabase migration list --linked

# 3. All 5 functions ACTIVE
supabase functions list

# 4. Anthropic secret set
supabase secrets list | grep ANTHROPIC_API_KEY

# 5. Mobile env points at prod with publishable key
grep '^EXPO_PUBLIC_SUPABASE_URL=https://' /Users/mizzy/Developer/Trivolta/mobile/.env.local
grep '^EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_' /Users/mizzy/Developer/Trivolta/mobile/.env.local

# 6. Mobile env gitignored
cd /Users/mizzy/Developer/Trivolta/mobile && git check-ignore .env.local

# 7. Smoke test data
cd /Users/mizzy/Developer/Trivolta
supabase db remote --linked psql -c "select count(*) from public.profiles where username = 'prodsmoketest';"
supabase db remote --linked psql -c "select count(*) from public.scores s join public.profiles p on p.id = s.user_id where p.username = 'prodsmoketest';"
supabase db remote --linked psql -c "select count(*) from public.daily_challenge_completions dcc join public.profiles p on p.id = dcc.user_id where p.username = 'prodsmoketest';"

# 8. No secrets staged
git status --porcelain | grep -E '\.env\.local'
# expect: no output
```

If any check fails, do not commit. Report to Mac Claude.
