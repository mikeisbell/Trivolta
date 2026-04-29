# INSTRUCTIONS_LOCAL_NEW_KEYS.md

## Task

Migrate Trivolta's local development environment to the Supabase new API key system (`sb_publishable_*` / `sb_secret_*`) and remove all use of legacy `anon` / `service_role` keys. This includes upgrading the Supabase CLI and Maestro to current latest, regenerating the local stack with asymmetric JWT signing keys, patching all 5 Edge Functions to be compatible with the new keys, updating `mobile/.env.local` and `mobile/maestro/.env.maestro` to use the new key values, updating CLAUDE.md to reflect the new auth pattern, and confirming the full Maestro suite still passes.

This task is a **prerequisite for `INSTRUCTIONS_PRODUCTION_SUPABASE.md`**. Do not proceed to production until local is fully migrated and the Maestro suite is green on new keys.

## Background

The new `sb_publishable_*` / `sb_secret_*` keys are not JWTs. Three consequences for Trivolta:

1. **Edge Functions must run with `--no-verify-jwt`.** The Supabase platform's gateway-level JWT verification is incompatible with non-JWT keys. Verification must happen inside each function — Trivolta already does this for 4 of 5 functions (the `Authorization` header check + `auth.getUser()`). The fifth, `daily-challenge`, currently accepts unauthenticated calls and must be hardened.

2. **`Deno.env.get('SUPABASE_ANON_KEY')` is unreliable on new-key projects.** A known platform bug causes the env var to return stale or wrong-format values. Workaround: read the publishable key from `req.headers.get('apikey')` with env fallback.

3. **CLAUDE.md rule update required.** The existing rule "Do NOT serve these functions with `--no-verify-jwt` in production" was correct under the legacy system. Under new keys, `--no-verify-jwt` is the documented and required deploy flag — provided every function validates auth in code.

## Toolchain notes (verified from prior run, 2026-04-28)

These are LOCAL-ONLY toolchain quirks. They do NOT apply to production deploys.

- **`supabase functions serve` on CLI 2.95.4+ does not auto-load `supabase/.env.local`.** The `ANTHROPIC_API_KEY` will be unreachable to Edge Functions and `solo-question` / `generate-questions` will fail with "Could not resolve authentication method" (Anthropic SDK error) unless the file is passed explicitly via `--env-file`. Use:
  ```
  supabase functions serve --no-verify-jwt --env-file supabase/.env.local
  ```
  This is a `functions serve` (local) quirk only. Production `functions deploy` uses Supabase's encrypted secret store via `supabase secrets set` and is unaffected.

- **Maestro 2.5.0+ parallelizes flows within a single shard, even with `--shards=1`.** Tests 03–26 share the test user created in test_02 and a single simulator app, so parallel execution causes auth-dependent tests to fail non-deterministically. The `mobile/run_tests.sh` script handles this by running each flow as its own `maestro test` invocation. Never call `maestro test` directly on the directory. If a future "simplification" tries to revert to a single directory-level invocation, it will break — even with `--shards=1`.

## Verifiable objective

- [ ] Supabase CLI is upgraded to the **latest stable release** (currently 2.95.4 as of Apr 27, 2026 — Claude Code must check the actual latest at run time and upgrade to it)
- [ ] Maestro is upgraded to the **latest stable release** (currently 2.5.x as of Apr 28, 2026 — Claude Code must check the actual latest at run time and upgrade to it)
- [ ] `supabase/config.toml` has `[auth].signing_keys_path = "./signing_keys.json"` set
- [ ] `supabase/signing_keys.json` exists, contains a valid ES256 signing key, and is gitignored
- [ ] `supabase status` after `supabase start` outputs a `Publishable key: sb_publishable_*` and `Secret key: sb_secret_*` (not legacy `anon`/`service_role`)
- [ ] All 5 Edge Functions are patched: every `Deno.env.get('SUPABASE_ANON_KEY')` standalone read is replaced with `(req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '')`
- [ ] `daily-challenge` rejects requests with missing/invalid `Authorization` header (returns 401) — matches the auth pattern of the other 4 functions
- [ ] `mobile/.env.local` contains the local `sb_publishable_*` key as `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `mobile/maestro/.env.maestro` contains the local `sb_secret_*` key as `SUPABASE_SERVICE_KEY`
- [ ] `supabase/.env.local` is updated to remove legacy keys and reference new keys (used by Edge Functions in local dev only)
- [ ] CLAUDE.md is updated: the `--no-verify-jwt` rule is rewritten for the new-key system, AND the Maestro sequential-execution rule reflects the per-flow loop pattern (not `--shards=1`)
- [ ] `mobile/run_tests.sh` runs flows one-per-invocation (not as a directory-level call) so Maestro 2.5.0+ parallelization does not break sequential dependency on test_02
- [ ] All 25 active Maestro tests pass on a fresh `supabase db reset` against the new-key local stack

## Constraints

- Do NOT commit any secret. `signing_keys.json`, all `.env.local`, and `.env.maestro` must be gitignored before they are created or modified.
- Do NOT use legacy `anon` or `service_role` anywhere — local or remote. After this task, neither should appear in any `.env*` file or any source file.
- Do NOT modify any migration file.
- Do NOT modify any mobile app source file. Specifically `mobile/lib/supabase.ts` does NOT change — the variable name `EXPO_PUBLIC_SUPABASE_ANON_KEY` stays; only its value changes.
- Do NOT change Edge Function logic beyond the two specific changes called out in Step 6 (apikey-header read pattern + daily-challenge auth gate). No prompt changes, no response shape changes, no error handling changes.
- Do NOT change `app.json`, `package.json`, or `tsconfig.json`.
- Do NOT delete any existing migration. Asymmetric signing keys are configured via `signing_keys.json` and `config.toml`, not via SQL.
- Do NOT pin a specific older version of the Supabase CLI or Maestro. Always upgrade to current latest. If Mike has explicitly pinned a version somewhere (no evidence of this in the current repo), surface that to Mac Claude before overriding.

## Steps

### Step 1 — Upgrade the Supabase CLI to current latest

Check current installed version:

```bash
supabase --version
```

Check the latest available release:

```bash
brew update
brew info supabase/tap/supabase | head -3
```

Upgrade to latest:

```bash
brew upgrade supabase/tap/supabase
supabase --version
```

If Homebrew is not the install method (verify via `which supabase`), upgrade by whichever method matches Mike's setup. Confirm:

```bash
supabase --version
# expect: a version >= 2.95.4 (the latest as of when this INSTRUCTIONS file was written; newer is fine)
```

If the installed version is somehow ahead of `brew info`'s reported latest (e.g. brew tap not refreshed), re-run `brew update` and verify again. Do not proceed until installed == latest available.

### Step 2 — Upgrade Maestro to current latest

Check current installed version:

```bash
maestro --version
```

Upgrade to latest. Maestro's recommended install path is the install script:

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

This is idempotent — reinstalls latest over an existing install. After the script completes, restart your shell (or `source ~/.zshrc`) to pick up the new binary, then:

```bash
maestro --version
# expect: a version >= 2.5.0 (the latest as of when this INSTRUCTIONS file was written; newer is fine)
```

If Mike installed Maestro via Homebrew instead of the install script, use:

```bash
brew upgrade maestro
maestro --version
```

WORKFLOW.md currently notes "`assertVisible` with inline `timeout` not supported in Maestro 2.4.0 — use `extendedWaitUntil`." After upgrade, re-check that note: if the new Maestro version supports inline `timeout`, the workaround is no longer mandatory but the existing tests using `extendedWaitUntil` will still work — leave them alone for this task. Only re-evaluate that workaround in a separate follow-up task.

**Note on Maestro 2.5.0 parallelization:** Maestro 2.5.0 changed default behavior to parallelize flows within a single shard, even with `--shards=1`. This breaks Trivolta's tests because tests 03–26 depend on the user created by test_02. Step 13 covers the `run_tests.sh` rewrite to force one-flow-per-invocation execution. Do NOT skip that step.

### Step 3 — Stop local Supabase

```bash
cd /Users/mizzy/Developer/Trivolta
supabase stop
```

This must be done before reconfiguring. Leaving the stack running while editing `config.toml` causes inconsistent state.

### Step 4 — Update `.gitignore` for signing keys

Edit `/Users/mizzy/Developer/Trivolta/supabase/.gitignore`. Add a new line at the bottom if not present:

```
signing_keys.json
```

The existing `supabase/.gitignore` already excludes `.env.local` and `.env.*.local`. Add the signing keys line so it never gets committed.

Verify:

```bash
cd /Users/mizzy/Developer/Trivolta
echo "test" > supabase/signing_keys.json
git check-ignore supabase/signing_keys.json
# expect: supabase/signing_keys.json
rm supabase/signing_keys.json
```

### Step 5 — Configure `config.toml` for asymmetric signing keys, then generate the key

Open `/Users/mizzy/Developer/Trivolta/supabase/config.toml`. Find the `[auth]` section. Locate the line:

```
# signing_keys_path = "./signing_keys.json"
```

Uncomment and set:

```
signing_keys_path = "./signing_keys.json"
```

Save. Do NOT change any other `[auth]` value.

Generate the local signing key:

```bash
cd /Users/mizzy/Developer/Trivolta
supabase gen signing-key --algorithm ES256
```

This writes `supabase/signing_keys.json` with an ES256 keypair. Verify:

```bash
test -f supabase/signing_keys.json && echo "OK"
git check-ignore supabase/signing_keys.json
# expect: OK then supabase/signing_keys.json
```

### Step 6 — Patch all 5 Edge Functions

Two changes apply across the functions.

**Change A — apikey-header read pattern (all 5 functions):**

In each of the 5 files below, replace every standalone occurrence of:

```ts
Deno.env.get('SUPABASE_ANON_KEY')!
```

with:

```ts
(req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '')
```

Files:
- `supabase/functions/solo-question/index.ts`
- `supabase/functions/generate-questions/index.ts`
- `supabase/functions/create-lobby/index.ts`
- `supabase/functions/join-lobby/index.ts`
- `supabase/functions/daily-challenge/index.ts`

This works on local (env populated correctly) and prod (env may lag). The `req` argument is already in scope inside `serve(async (req) => { ... })` in every function.

**Change B — `daily-challenge` auth gate (`daily-challenge` only):**

Currently `daily-challenge` accepts `req.headers.get('Authorization') ?? ''` and silently allows unauthenticated calls. With `--no-verify-jwt`, this becomes a hole. Add an auth gate at the top of the handler.

Open `supabase/functions/daily-challenge/index.ts`. The current structure is roughly:

```ts
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const today = new Date().toISOString().slice(0, 10)
    const serviceClient = createClient(...)
    const { data: challenge, error: upsertError } = await serviceClient...
    ...
    const authHeader = req.headers.get('Authorization')
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader ?? '' } } }
    )
    const { data: completion } = await userClient.from('daily_challenge_completions')...
```

Refactor to:

```ts
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    (req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''),
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  try {
    const today = new Date().toISOString().slice(0, 10)
    const serviceClient = createClient(...)  // unchanged
    const { data: challenge, error: upsertError } = await serviceClient...  // unchanged

    // REMOVE the duplicate authHeader/userClient construction below — already done above
    // Reuse the userClient already in scope:
    const { data: completion } = await userClient
      .from('daily_challenge_completions')
      .select('score')
      .eq('challenge_id', challenge.id)
      .maybeSingle()
    ...
```

After the patch, `daily-challenge` matches the auth pattern of the other 4 functions: 401 on missing `Authorization`, 401 on invalid JWT, 200 only for authenticated users.

**Verify the patches:**

```bash
cd /Users/mizzy/Developer/Trivolta
# No standalone SUPABASE_ANON_KEY env reads should remain. Every match must be inside the fallback chain.
grep -rn "Deno.env.get('SUPABASE_ANON_KEY')" supabase/functions/ | grep -v "?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''"
# expect: no output

# daily-challenge has the auth gate
grep -A1 "if (!authHeader)" supabase/functions/daily-challenge/index.ts | grep "Unauthorized"
# expect: a match
```

### Step 7 — Start the local stack and capture new keys

```bash
cd /Users/mizzy/Developer/Trivolta
supabase start
supabase status
```

Expected output includes:

```
Publishable key: sb_publishable_xxxxx
Secret key: sb_secret_xxxxx
```

If `supabase status` still prints legacy `anon key`/`service_role key` instead of publishable/secret, something went wrong with Step 5. Re-check before proceeding.

Save both values — used in Steps 8, 9, 10.

### Step 8 — Update `mobile/.env.local`

Open in VS Code (NOT terminal). Replace contents with:

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the-local-sb_publishable_-key-from-step-7>
```

The variable name `EXPO_PUBLIC_SUPABASE_ANON_KEY` stays — `mobile/lib/supabase.ts` reads it. The value is now the publishable key.

### Step 9 — Update `mobile/maestro/.env.maestro`

Open in VS Code. Replace contents with:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_KEY=<the-local-sb_secret_-key-from-step-7>
```

The variable name `SUPABASE_SERVICE_KEY` stays — the maestro `scripts/*.js` files read it via the YAML test runners. The value is now the secret key.

The maestro scripts send the secret key in both `apikey` and `Authorization: Bearer` headers with identical values. Per Supabase docs this is the documented exception that allows non-JWT keys in the Authorization header. Confirmed safe.

### Step 10 — Update `supabase/.env.local`

Open in VS Code. The Edge Functions read `ANTHROPIC_API_KEY` from this file in local dev. Confirm `supabase/.env.local` contains:

```
ANTHROPIC_API_KEY=<the-existing-anthropic-key>
```

Remove any lines referencing legacy `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` if present — those values are auto-injected by `supabase functions serve` and don't belong in the file.

**Important — `--env-file` flag is required at serve time.** As of Supabase CLI 2.95.4, `supabase functions serve` does NOT auto-load `supabase/.env.local`. The `ANTHROPIC_API_KEY` set above will be invisible to Edge Functions unless the serve command is invoked with `--env-file supabase/.env.local`. This is reflected in the serve command in Step 13 and in `mobile/run_tests.sh`'s prereq comment.

### Step 11 — Update `mobile/.env.example` and `mobile/maestro/.env.maestro.example`

Edit `mobile/.env.example` to:

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_your_key_here
```

Edit `mobile/maestro/.env.maestro.example` to:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_KEY=sb_secret_your_key_here
```

Placeholder values only — never real keys.

### Step 12 — Update CLAUDE.md

Open `/Users/mizzy/Developer/Trivolta/CLAUDE.md`. Find the section starting with `## Edge Functions Require Authorization Header`. Replace its body (everything between that heading and the next `##` heading) with:

```markdown
All 5 Edge Functions (`solo-question`, `generate-questions`, `create-lobby`, `join-lobby`, `daily-challenge`) MUST validate the `Authorization` header in code and return 401 on missing or invalid JWT. They use `auth.getUser()` against a Supabase client constructed with the user's JWT.

**`--no-verify-jwt` is required, not forbidden.** Trivolta uses the new Supabase API key system (`sb_publishable_*` / `sb_secret_*`). These keys are not JWTs, so platform-level JWT verification at the gateway is incompatible. In-function auth via `Authorization` header check is the documented and correct pattern. Both local (`supabase functions serve --no-verify-jwt --env-file supabase/.env.local`) and production (`supabase functions deploy --no-verify-jwt`) use the flag.

The publishable key is read from `req.headers.get('apikey')` with `Deno.env.get('SUPABASE_ANON_KEY')` as fallback — the env var sync is unreliable on new-key projects, so the header is the source of truth.

Never construct a Supabase user client inside an Edge Function with `Deno.env.get('SUPABASE_ANON_KEY')` standalone — always use the apikey-header-with-env-fallback pattern.

Local development uses asymmetric JWT signing keys via `supabase/signing_keys.json` and `config.toml`'s `[auth].signing_keys_path`. The keys file is gitignored.
```

Then find the section starting with `## Maestro Must Run Sequential` (whatever its current title). Replace its body with:

```markdown
Maestro 2.5.0+ runs directory-level test suites in parallel even with `--shards=1`. Tests 03–26 depend on the test user created in test_02 and on a single shared simulator app, so parallel execution causes auth-dependent tests to fail non-deterministically. The `run_tests.sh` script forces sequential execution by looping `maestro test` once per flow file:

​```bash
for f in maestro/test_*.yaml; do
  maestro test --env ... "$f"
done
​```

Always run via `./run_tests.sh`. Never call `maestro test` directly on the directory.
```

(Note the zero-width-space-prefixed code fences `​```` are intentional to escape the nested fence — render and replace with actual triple-backticks when writing.)

### Step 13 — Rewrite `mobile/run_tests.sh` to loop one flow per invocation

Replace the contents of `/Users/mizzy/Developer/Trivolta/mobile/run_tests.sh` with the loop-per-flow pattern. Preserve:
- `set -a` / `source maestro/.env.maestro` / `set +a` env loading
- The single-flow shortcut (`./run_tests.sh test_08_solo_game_loop.yaml`) for debugging one test
- Output to `~/trivolta_test_output.txt`
- Non-zero exit on any failure

Update the prereq comment block at the top of the file to include the `--env-file supabase/.env.local` flag on the `supabase functions serve` command.

### Step 14 — Reset local DB and run the Maestro suite

```bash
cd /Users/mizzy/Developer/Trivolta
supabase db reset
```

In a separate terminal:

```bash
cd /Users/mizzy/Developer/Trivolta
supabase functions serve --no-verify-jwt --env-file supabase/.env.local
```

Back in the original terminal:

```bash
cd /Users/mizzy/Developer/Trivolta/mobile
npx expo prebuild --platform ios --clean
npx expo run:ios
# wait for the app to install and launch on the simulator, then close the simulator's app and Ctrl-C the run:ios process
./run_tests.sh
```

All 25 active Maestro tests must pass. If any fail, the patch is wrong somewhere — fix before reporting done. Common failure modes:

- `Could not resolve authentication method` from Anthropic SDK → the `--env-file supabase/.env.local` flag is missing on the `supabase functions serve` command. The `ANTHROPIC_API_KEY` is unreachable.
- `PGRST301: No suitable key or wrong key type` → forgot to re-query `supabase status` after Step 7; current `mobile/.env.local` value is stale
- `401 Unauthorized` on every function call → apikey-header pattern wrong in one of the functions; re-check Step 6's grep
- Maestro `ensure_test_user_02.js` failing with auth error → `mobile/maestro/.env.maestro` has wrong key; re-check Step 9
- Maestro reports tests stomping on each other (e.g. test_03 fails because test_02's user wasn't ready) → `run_tests.sh` is calling `maestro test` on the directory instead of looping per flow; re-check Step 13
- Maestro reports "command not recognised" on a flag — Maestro upgrade in Step 2 may have deprecated something; check `maestro --help` and consult the Maestro CHANGELOG for the version Mike now has

### Step 15 — Update tracker

Edit `/Users/mizzy/Developer/Trivolta/TRIVOLTA_TRACKER.md`:

- Under "Phase 3 — Beta Testing", flip `Local dev migrated to new Supabase API keys (sb_publishable / sb_secret) — INSTRUCTIONS_LOCAL_NEW_KEYS.md` from ⬜ to ✅
- Under "INSTRUCTIONS Files Written", flip `INSTRUCTIONS_LOCAL_NEW_KEYS.md` from ⬜ to ✅

### Step 16 — Commit

```bash
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > /tmp/trivolta_diff.txt
```

After Mac Claude review of the diff:

```bash
git add INSTRUCTIONS_LOCAL_NEW_KEYS.md \
        TRIVOLTA_TRACKER.md \
        CLAUDE.md \
        supabase/config.toml \
        supabase/.gitignore \
        supabase/functions/ \
        mobile/.env.example \
        mobile/maestro/.env.maestro.example \
        mobile/run_tests.sh
git commit -m "feat: local dev migrated to new sb_publishable/sb_secret keys, all Edge Functions hardened, CLI+Maestro upgraded to latest"
git push
git status
# none of these may appear staged: signing_keys.json, mobile/.env.local, supabase/.env.local, mobile/maestro/.env.maestro
```

If any secret file appears staged or untracked-but-going-to-be-committed, stop and fix `.gitignore` first.

## Verification

```bash
# 1. Supabase CLI on latest
supabase --version
brew update && brew info supabase/tap/supabase | head -3
# Confirm installed version equals or exceeds the brew-reported "stable" version.

# 2. Maestro on latest
maestro --version
# Confirm against latest at https://github.com/mobile-dev-inc/Maestro/releases — installed must equal or exceed.

# 3. Signing keys configured and gitignored
test -f /Users/mizzy/Developer/Trivolta/supabase/signing_keys.json && echo "exists"
cd /Users/mizzy/Developer/Trivolta && git check-ignore supabase/signing_keys.json
# expect: exists, then supabase/signing_keys.json
grep "^signing_keys_path" /Users/mizzy/Developer/Trivolta/supabase/config.toml
# expect: signing_keys_path = "./signing_keys.json"

# 4. Local stack outputs new keys
cd /Users/mizzy/Developer/Trivolta && supabase status | grep -E "Publishable key|Secret key"
# expect: two lines, sb_publishable_ and sb_secret_

# 5. All Edge Functions patched — no standalone env reads
cd /Users/mizzy/Developer/Trivolta
grep -rn "Deno.env.get('SUPABASE_ANON_KEY')" supabase/functions/ | grep -v "?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''"
# expect: no output

# 6. daily-challenge auth gate
grep -A1 "if (!authHeader)" supabase/functions/daily-challenge/index.ts | grep "Unauthorized"
# expect: a match

# 7. Mobile env uses publishable key
grep '^EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_' /Users/mizzy/Developer/Trivolta/mobile/.env.local
# expect: a match

# 8. Maestro env uses secret key
grep '^SUPABASE_SERVICE_KEY=sb_secret_' /Users/mizzy/Developer/Trivolta/mobile/maestro/.env.maestro
# expect: a match

# 9. CLAUDE.md updated — both rules
grep "no-verify-jwt. is required" /Users/mizzy/Developer/Trivolta/CLAUDE.md
# expect: a match
grep "Maestro 2.5.0" /Users/mizzy/Developer/Trivolta/CLAUDE.md
# expect: a match

# 10. run_tests.sh loops per flow
grep "for f in maestro/test_" /Users/mizzy/Developer/Trivolta/mobile/run_tests.sh
# expect: a match

# 11. run_tests.sh prereq comment mentions --env-file
grep -- "--env-file supabase/.env.local" /Users/mizzy/Developer/Trivolta/mobile/run_tests.sh
# expect: a match

# 12. Maestro suite green
cd /Users/mizzy/Developer/Trivolta/mobile && ./run_tests.sh 2>&1 | tail -10
# expect: 25 passing, 0 failing

# 13. Nothing secret staged
cd /Users/mizzy/Developer/Trivolta
git status --porcelain | grep -E 'signing_keys\.json|\.env\.local|\.env\.maestro$'
# expect: no output
```

If any check fails, do not commit. Report to Mac Claude.
