# INSTRUCTIONS_LOBBY_TESTS.md — Maestro tests for lobby flows

## Task

Write four Maestro E2E tests covering lobby creation, joining, a full game, and leaving. The multi-player constraint (Maestro controls one device) is solved by seeding lobby state directly into Supabase via admin API scripts before the app-under-test runs. This follows the same pattern as `delete_test_user.js` in test_02.

Four new scripts are required: `ensure_test_user_03.js`, `create_test_lobby.js`, `create_join_test_lobby.js`, `seed_full_game_lobby.js`, and `cleanup_test_lobby.js`. These use Maestro's built-in `http` API — no Java interop, no `require()`, no `java.lang` — compatible with the GraalVM sandbox. Output values are returned to YAML via `output.someKey` and read as `${output.someKey}`.

Key facts from source code:
- `play-screen` — testID on PlayScreen root
- `play-create-lobby` — testID on "Create a lobby" button
- `play-join-lobby` — testID on "Join a lobby" button
- `create-lobby-category-science` / `create-lobby-category-pop_culture` / `create-lobby-category-history` / `create-lobby-category-custom` — category card testIDs
- `create-lobby-submit` — testID on "Create lobby" button (disabled until category selected)
- `lobby-waiting-code` — testID showing the 4-char room code
- `lobby-waiting-player-count` — testID showing "N / 8"
- `lobby-waiting-start` — testID on "Start game" button (disabled until players.length >= 2, host only)
- `lobby-waiting-leave` — testID on "Leave lobby" button (guests only)
- `join-lobby-code-box-0` through `join-lobby-code-box-3` — testIDs on the 4 code input boxes
- `join-lobby-submit` — testID on "Join lobby" button
- `join-lobby-error` — testID on error text
- `lobby-game-progress` — testID on "N / 10" progress text
- `lobby-game-answer-0` through `lobby-game-answer-3` — answer button testIDs
- `lobby-game-next` — testID on "Next question →" / "See results" (host only — guests see "Waiting for host…")
- `lobby-results-my-score` — testID on my stats card
- `lobby-results-list` — testID on rankings FlatList
- `lobby-results-home` — testID on "Back to home" button

Lobby rules from CLAUDE.md and source:
- Questions are generated before game start — `generateLobbyQuestions` called by host, then `startLobbyGame`
- `lobby-game-next` only renders when `isHost === '1'`
- `lobby-waiting-start` disabled until `players.length >= 2`
- Max lobby size 8, enforced in Edge Function

Database tables scripts write to (schema confirmed):
- `public.lobbies` — `id`, `code` (4-char unique), `host_id`, `category`, `status` ('waiting')
- `public.lobby_players` — `lobby_id`, `user_id`
- `public.lobby_questions` — `lobby_id`, `question_index` (0–9), `question`, `answers` (jsonb array of 4 strings), `correct_index`, `explanation`, `difficulty`
- `public.game_sessions` — `lobby_id`, `question_index`, `starts_at` (timestamptz)
- `public.profiles` — `id`, `username`

Deep link navigation: `app.json` does not have a `scheme` defined. Step 1 adds `"scheme": "trivolta"` so `openLink: "trivolta://..."` works in test_14. A native rebuild is required after this change.

Second test user: `testuser_maestro_03@trivolta-test.com` / `TestPassword123!` / username `maestro03`.

---

## Verifiable Objective

- [ ] `app.json` has `"scheme": "trivolta"` added
- [ ] `scripts/ensure_test_user_03.js` exists — creates `testuser_maestro_03` if not present; sets `output.user03Id`
- [ ] `scripts/create_test_lobby.js` exists — creates lobby (host + guest seeded, 10 questions, Q0 game_session); sets `output.lobbyId`, `output.roomCode`
- [ ] `scripts/create_join_test_lobby.js` exists — creates lobby with host only (no guest, no questions, code `JOIN`); sets `output.lobbyId`, `output.roomCode`
- [ ] `scripts/seed_full_game_lobby.js` exists — looks up host by email, creates lobby (host + guest, 10 questions, no game_session — app creates that); sets `output.lobbyId`
- [ ] `scripts/cleanup_test_lobby.js` exists — deletes lobby by `LOBBY_ID` env var
- [ ] `test_12_create_lobby.yaml` exists and passes — host creates lobby via UI, sees `lobby-waiting-code`, sees `1 / 8`
- [ ] `test_13_join_lobby.yaml` exists and passes — guest joins seeded lobby via room code, sees `2 / 8`
- [ ] `test_14_lobby_game.yaml` exists and passes — host deep-links to seeded waiting screen, taps Start, answers all 10, reaches `lobby-results-my-score`
- [ ] `test_15_leave_lobby.yaml` exists and passes — guest joins seeded lobby, taps `lobby-waiting-leave`, confirms Alert "Leave", lands on `home-screen`
- [ ] Native app rebuilt: `npx expo run:ios` after `app.json` change
- [ ] All 15 tests pass when running `./run_tests.sh`
- [ ] `TRIVOLTA_TRACKER.md` updated — test_12 through test_15 marked ✅, `INSTRUCTIONS_LOBBY_TESTS.md` added to INSTRUCTIONS Files Written
- [ ] `TEST_PLAN.md` updated — test_12 through test_15 marked ✅ Passing

---

## Constraints

- Scripts use ONLY Maestro's built-in `http` API (`http.get`, `http.post`, `http.delete`) — no `require()`, no Java interop
- All `http` calls include headers: `{ apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' }`
- Write directly to Supabase REST (`/rest/v1/`) — do NOT call Edge Functions from scripts
- Use `Prefer: 'return=representation'` header on POST calls that need the inserted row back
- Room codes must be unique across tests: `TEST` (create_test_lobby), `JOIN` (create_join_test_lobby), `GAME` (seed_full_game_lobby) — cleanup runs after each test so no collision
- Do NOT use `sleep` anywhere in these tests
- Do NOT modify any existing test files (test_01 through test_11)
- Do NOT modify any screen source files
- `lobby-waiting-start` is disabled with 1 player — test_12 must NOT tap it
- test_14 seeds the lobby with host + guest so `lobby-waiting-start` is enabled
- test_14 does NOT seed `game_sessions` — the app's `createGameSession` call handles Q0 when `loadQuestion(0)` runs on the host device
- test_15 is a GUEST flow: maestro02 joins a lobby hosted by the seeded maestro03, then taps `lobby-waiting-leave`
- Cleanup script runs as the final step in test_13, test_14, and test_15

---

## Steps

### Step 1 — Add deep link scheme to app.json

Edit `/Users/mizzy/Developer/Trivolta/mobile/app.json`. Add `"scheme": "trivolta"` inside the `"expo"` object, alongside `"name"`, `"slug"`, etc.

Then rebuild the native app:
```bash
cd /Users/mizzy/Developer/Trivolta/mobile
npx expo run:ios
```

Do not proceed to writing tests until the build succeeds.

### Step 2 — Write `scripts/ensure_test_user_03.js`

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/scripts/ensure_test_user_03.js`

```javascript
// Ensures testuser_maestro_03 exists in Supabase auth + profiles.
// Sets output.user03Id to the auth user UUID.
var HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  'Content-Type': 'application/json'
}

var listResp = http.get(SUPABASE_URL + '/auth/v1/admin/users?per_page=1000', { headers: HEADERS })
var body = JSON.parse(listResp.body)
var users = body.users || body
var existing = null
for (var i = 0; i < users.length; i++) {
  if (users[i].email === 'testuser_maestro_03@trivolta-test.com') {
    existing = users[i]
    break
  }
}

var userId
if (existing) {
  userId = existing.id
} else {
  var createResp = http.post(SUPABASE_URL + '/auth/v1/admin/users', {
    headers: HEADERS,
    body: JSON.stringify({
      email: 'testuser_maestro_03@trivolta-test.com',
      password: 'TestPassword123!',
      email_confirm: true
    })
  })
  var created = JSON.parse(createResp.body)
  userId = created.id

  http.post(SUPABASE_URL + '/rest/v1/profiles', {
    headers: HEADERS,
    body: JSON.stringify({ id: userId, username: 'maestro03' })
  })
}

output.user03Id = userId
```

### Step 3 — Write `scripts/create_test_lobby.js`

Used by test_14 (full game seed). Creates lobby with host + guest, 10 questions, no game_session.

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/scripts/create_test_lobby.js`

```javascript
// Creates a seeded lobby: host = HOST_USER_ID, guest = GUEST_USER_ID, 10 questions.
// Does NOT seed game_sessions — app handles Q0 session on loadQuestion(0).
// Sets output.lobbyId, output.roomCode.
var HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  'Content-Type': 'application/json'
}
var BASE = SUPABASE_URL + '/rest/v1'

var lobbyResp = http.post(BASE + '/lobbies?select=id,code', {
  headers: Object.assign({}, HEADERS, { Prefer: 'return=representation' }),
  body: JSON.stringify({
    code: ROOM_CODE,
    host_id: HOST_USER_ID,
    category: 'science',
    status: 'waiting',
    max_players: 8
  })
})
var lobby = JSON.parse(lobbyResp.body)[0]
var lobbyId = lobby.id
var roomCode = lobby.code

http.post(BASE + '/lobby_players', {
  headers: HEADERS,
  body: JSON.stringify({ lobby_id: lobbyId, user_id: HOST_USER_ID })
})

http.post(BASE + '/lobby_players', {
  headers: HEADERS,
  body: JSON.stringify({ lobby_id: lobbyId, user_id: GUEST_USER_ID })
})

var questions = []
for (var i = 0; i < 10; i++) {
  questions.push({
    lobby_id: lobbyId,
    question_index: i,
    question: 'Which planet is the Red Planet? (Q' + i + ')',
    answers: JSON.stringify(['Mars', 'Venus', 'Jupiter', 'Saturn']),
    correct_index: 0,
    explanation: 'Mars appears red due to iron oxide.',
    difficulty: 'easy'
  })
}
http.post(BASE + '/lobby_questions', {
  headers: HEADERS,
  body: JSON.stringify(questions)
})

output.lobbyId = lobbyId
output.roomCode = roomCode
```

### Step 4 — Write `scripts/create_join_test_lobby.js`

Used by test_13 and test_15. Creates lobby with host only, no questions, no game_session. Room code passed in via env var.

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/scripts/create_join_test_lobby.js`

```javascript
// Creates a waiting lobby with HOST_USER_ID only — no guest, no questions.
// Sets output.lobbyId, output.roomCode.
var HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  'Content-Type': 'application/json'
}
var BASE = SUPABASE_URL + '/rest/v1'

var lobbyResp = http.post(BASE + '/lobbies?select=id,code', {
  headers: Object.assign({}, HEADERS, { Prefer: 'return=representation' }),
  body: JSON.stringify({
    code: ROOM_CODE,
    host_id: HOST_USER_ID,
    category: 'science',
    status: 'waiting',
    max_players: 8
  })
})
var lobby = JSON.parse(lobbyResp.body)[0]
var lobbyId = lobby.id
var roomCode = lobby.code

http.post(BASE + '/lobby_players', {
  headers: HEADERS,
  body: JSON.stringify({ lobby_id: lobbyId, user_id: HOST_USER_ID })
})

output.lobbyId = lobbyId
output.roomCode = roomCode
```

### Step 5 — Write `scripts/seed_full_game_lobby.js`

Used by test_14. Looks up host by email, creates lobby with host + guest + 10 questions.

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/scripts/seed_full_game_lobby.js`

```javascript
// Creates full game lobby: resolves host from HOST_EMAIL, adds GUEST_USER_ID, seeds 10 questions.
// Sets output.lobbyId.
var HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  'Content-Type': 'application/json'
}
var BASE = SUPABASE_URL + '/rest/v1'

// Resolve host user id from email via admin API
var listResp = http.get(SUPABASE_URL + '/auth/v1/admin/users?per_page=1000', { headers: HEADERS })
var body = JSON.parse(listResp.body)
var users = body.users || body
var hostUserId = null
for (var i = 0; i < users.length; i++) {
  if (users[i].email === HOST_EMAIL) {
    hostUserId = users[i].id
    break
  }
}

var lobbyResp = http.post(BASE + '/lobbies?select=id,code', {
  headers: Object.assign({}, HEADERS, { Prefer: 'return=representation' }),
  body: JSON.stringify({
    code: 'GAME',
    host_id: hostUserId,
    category: 'science',
    status: 'waiting',
    max_players: 8
  })
})
var lobby = JSON.parse(lobbyResp.body)[0]
var lobbyId = lobby.id

http.post(BASE + '/lobby_players', {
  headers: HEADERS,
  body: JSON.stringify({ lobby_id: lobbyId, user_id: hostUserId })
})

http.post(BASE + '/lobby_players', {
  headers: HEADERS,
  body: JSON.stringify({ lobby_id: lobbyId, user_id: GUEST_USER_ID })
})

var questions = []
for (var i = 0; i < 10; i++) {
  questions.push({
    lobby_id: lobbyId,
    question_index: i,
    question: 'Which planet is the Red Planet? (Q' + i + ')',
    answers: JSON.stringify(['Mars', 'Venus', 'Jupiter', 'Saturn']),
    correct_index: 0,
    explanation: 'Mars appears red due to iron oxide.',
    difficulty: 'easy'
  })
}
http.post(BASE + '/lobby_questions', {
  headers: HEADERS,
  body: JSON.stringify(questions)
})

output.lobbyId = lobbyId
```

### Step 6 — Write `scripts/cleanup_test_lobby.js`

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/scripts/cleanup_test_lobby.js`

```javascript
// Deletes test lobby by LOBBY_ID. FK CASCADE handles all child rows.
var HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  'Content-Type': 'application/json'
}
if (LOBBY_ID) {
  http.delete(SUPABASE_URL + '/rest/v1/lobbies?id=eq.' + LOBBY_ID, { headers: HEADERS })
}
```

### Step 7 — Write `test_12_create_lobby.yaml`

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/test_12_create_lobby.yaml`

```yaml
appId: com.mikeisbell.trivolta
---
# test_12: Host creates lobby via UI — verifies room code visible and player count 1/8

- clearState
- launchApp:
    clearState: true

- assertVisible:
    id: "auth-email-input"
- tapOn:
    id: "auth-email-input"
- inputText: "testuser_maestro_02@trivolta-test.com"
- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"
- tapOn:
    id: "auth-submit-button"
- tapOn:
    text: "Not Now"
    optional: true
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 15000

- tapOn:
    text: "Play"
- extendedWaitUntil:
    visible:
      id: "play-screen"
    timeout: 10000

- tapOn:
    id: "play-create-lobby"
- waitForAnimationToEnd

- tapOn:
    id: "create-lobby-category-science"
- waitForAnimationToEnd

- tapOn:
    id: "create-lobby-submit"

- extendedWaitUntil:
    visible:
      id: "lobby-waiting-code"
    timeout: 15000
- assertVisible:
    id: "lobby-waiting-player-count"
- assertVisible:
    text: "1 / 8"

# Start button is disabled with 1 player — do NOT tap it
# Navigate back to avoid leaving a dangling lobby
- back
```

### Step 8 — Write `test_13_join_lobby.yaml`

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/test_13_join_lobby.yaml`

```yaml
appId: com.mikeisbell.trivolta
env:
  SUPABASE_URL: ${SUPABASE_URL}
  SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
---
# test_13: Guest joins seeded lobby via room code — verifies player count 2/8

- clearState
- launchApp:
    clearState: true

# Ensure host user03 exists
- runScript:
    file: ./scripts/ensure_test_user_03.js
    env:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}

# Seed lobby with user03 as host only (room code JOIN)
- runScript:
    file: ./scripts/create_join_test_lobby.js
    env:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
      HOST_USER_ID: ${output.user03Id}
      ROOM_CODE: "JOIN"

- assertVisible:
    id: "auth-email-input"
- tapOn:
    id: "auth-email-input"
- inputText: "testuser_maestro_02@trivolta-test.com"
- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"
- tapOn:
    id: "auth-submit-button"
- tapOn:
    text: "Not Now"
    optional: true
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 15000

- tapOn:
    text: "Play"
- extendedWaitUntil:
    visible:
      id: "play-screen"
    timeout: 10000

- tapOn:
    id: "play-join-lobby"
- waitForAnimationToEnd

- tapOn:
    id: "join-lobby-code-box-0"
- inputText: "J"
- tapOn:
    id: "join-lobby-code-box-1"
- inputText: "O"
- tapOn:
    id: "join-lobby-code-box-2"
- inputText: "I"
- tapOn:
    id: "join-lobby-code-box-3"
- inputText: "N"

- tapOn:
    id: "join-lobby-submit"

- extendedWaitUntil:
    visible:
      id: "lobby-waiting-code"
    timeout: 15000
- assertVisible:
    text: "2 / 8"

# Cleanup
- runScript:
    file: ./scripts/cleanup_test_lobby.js
    env:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
      LOBBY_ID: ${output.lobbyId}
```

### Step 9 — Write `test_14_lobby_game.yaml`

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/test_14_lobby_game.yaml`

```yaml
appId: com.mikeisbell.trivolta
env:
  SUPABASE_URL: ${SUPABASE_URL}
  SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
---
# test_14: Host navigates seeded lobby — starts game, answers all 10, reaches results

- clearState
- launchApp:
    clearState: true

# Ensure guest user03 exists
- runScript:
    file: ./scripts/ensure_test_user_03.js
    env:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}

# Sign in as host (maestro02) first — need active session before deep link
- assertVisible:
    id: "auth-email-input"
- tapOn:
    id: "auth-email-input"
- inputText: "testuser_maestro_02@trivolta-test.com"
- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"
- tapOn:
    id: "auth-submit-button"
- tapOn:
    text: "Not Now"
    optional: true
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 15000

# Seed full game lobby — host resolved from email, guest = user03
- runScript:
    file: ./scripts/seed_full_game_lobby.js
    env:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
      HOST_EMAIL: "testuser_maestro_02@trivolta-test.com"
      GUEST_USER_ID: ${output.user03Id}

# Deep link to waiting screen as host
- openLink: "trivolta://lobby/waiting?lobbyId=${output.lobbyId}&isHost=1"

- extendedWaitUntil:
    visible:
      id: "lobby-waiting-code"
    timeout: 15000
- assertVisible:
    text: "2 / 8"

# Start game
- tapOn:
    id: "lobby-waiting-start"

# Answer all 10 questions as host
- extendedWaitUntil:
    visible:
      id: "lobby-game-progress"
    timeout: 30000
- tapOn:
    id: "lobby-game-answer-0"
- extendedWaitUntil:
    visible:
      id: "lobby-game-next"
    timeout: 5000
- tapOn:
    id: "lobby-game-next"

- extendedWaitUntil:
    visible:
      id: "lobby-game-progress"
    timeout: 30000
- tapOn:
    id: "lobby-game-answer-0"
- extendedWaitUntil:
    visible:
      id: "lobby-game-next"
    timeout: 5000
- tapOn:
    id: "lobby-game-next"

- extendedWaitUntil:
    visible:
      id: "lobby-game-progress"
    timeout: 30000
- tapOn:
    id: "lobby-game-answer-0"
- extendedWaitUntil:
    visible:
      id: "lobby-game-next"
    timeout: 5000
- tapOn:
    id: "lobby-game-next"

- extendedWaitUntil:
    visible:
      id: "lobby-game-progress"
    timeout: 30000
- tapOn:
    id: "lobby-game-answer-0"
- extendedWaitUntil:
    visible:
      id: "lobby-game-next"
    timeout: 5000
- tapOn:
    id: "lobby-game-next"

- extendedWaitUntil:
    visible:
      id: "lobby-game-progress"
    timeout: 30000
- tapOn:
    id: "lobby-game-answer-0"
- extendedWaitUntil:
    visible:
      id: "lobby-game-next"
    timeout: 5000
- tapOn:
    id: "lobby-game-next"

- extendedWaitUntil:
    visible:
      id: "lobby-game-progress"
    timeout: 30000
- tapOn:
    id: "lobby-game-answer-0"
- extendedWaitUntil:
    visible:
      id: "lobby-game-next"
    timeout: 5000
- tapOn:
    id: "lobby-game-next"

- extendedWaitUntil:
    visible:
      id: "lobby-game-progress"
    timeout: 30000
- tapOn:
    id: "lobby-game-answer-0"
- extendedWaitUntil:
    visible:
      id: "lobby-game-next"
    timeout: 5000
- tapOn:
    id: "lobby-game-next"

- extendedWaitUntil:
    visible:
      id: "lobby-game-progress"
    timeout: 30000
- tapOn:
    id: "lobby-game-answer-0"
- extendedWaitUntil:
    visible:
      id: "lobby-game-next"
    timeout: 5000
- tapOn:
    id: "lobby-game-next"

- extendedWaitUntil:
    visible:
      id: "lobby-game-progress"
    timeout: 30000
- tapOn:
    id: "lobby-game-answer-0"
- extendedWaitUntil:
    visible:
      id: "lobby-game-next"
    timeout: 5000
- tapOn:
    id: "lobby-game-next"

- extendedWaitUntil:
    visible:
      id: "lobby-game-progress"
    timeout: 30000
- tapOn:
    id: "lobby-game-answer-0"
- extendedWaitUntil:
    visible:
      id: "lobby-game-next"
    timeout: 5000
- tapOn:
    id: "lobby-game-next"

- extendedWaitUntil:
    visible:
      id: "lobby-results-my-score"
    timeout: 10000
- assertVisible:
    id: "lobby-results-list"

# Cleanup
- runScript:
    file: ./scripts/cleanup_test_lobby.js
    env:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
      LOBBY_ID: ${output.lobbyId}
```

### Step 10 — Write `test_15_leave_lobby.yaml`

Guest flow: maestro02 joins a lobby hosted by seeded maestro03, taps Leave, confirms Alert, lands on home.

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/test_15_leave_lobby.yaml`

```yaml
appId: com.mikeisbell.trivolta
env:
  SUPABASE_URL: ${SUPABASE_URL}
  SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
---
# test_15: Guest taps Leave lobby — Alert confirm → home screen

- clearState
- launchApp:
    clearState: true

# Ensure host user03 exists
- runScript:
    file: ./scripts/ensure_test_user_03.js
    env:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}

# Seed lobby with user03 as host only (room code LEAV)
- runScript:
    file: ./scripts/create_join_test_lobby.js
    env:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
      HOST_USER_ID: ${output.user03Id}
      ROOM_CODE: "LEAV"

- assertVisible:
    id: "auth-email-input"
- tapOn:
    id: "auth-email-input"
- inputText: "testuser_maestro_02@trivolta-test.com"
- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"
- tapOn:
    id: "auth-submit-button"
- tapOn:
    text: "Not Now"
    optional: true
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 15000

- tapOn:
    text: "Play"
- extendedWaitUntil:
    visible:
      id: "play-screen"
    timeout: 10000

- tapOn:
    id: "play-join-lobby"
- waitForAnimationToEnd

- tapOn:
    id: "join-lobby-code-box-0"
- inputText: "L"
- tapOn:
    id: "join-lobby-code-box-1"
- inputText: "E"
- tapOn:
    id: "join-lobby-code-box-2"
- inputText: "A"
- tapOn:
    id: "join-lobby-code-box-3"
- inputText: "V"

- tapOn:
    id: "join-lobby-submit"

- extendedWaitUntil:
    visible:
      id: "lobby-waiting-leave"
    timeout: 15000

# Tap Leave — Alert appears
- tapOn:
    id: "lobby-waiting-leave"

# Confirm the Alert
- tapOn:
    text: "Leave"

# Should land on home screen
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 10000

# Cleanup
- runScript:
    file: ./scripts/cleanup_test_lobby.js
    env:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
      LOBBY_ID: ${output.lobbyId}
```

### Step 11 — Update TRIVOLTA_TRACKER.md

Mark test_12 through test_15 as ✅ Done in Phase 2. Add `INSTRUCTIONS_LOBBY_TESTS.md` to INSTRUCTIONS Files Written section.

### Step 12 — Update TEST_PLAN.md

Update test_12 through test_15 status from ⬜ to ✅ Passing.

---

## Verification

```bash
cd /Users/mizzy/Developer/Trivolta/mobile

# Prerequisites:
# Terminal 1: cd /Users/mizzy/Developer/Trivolta && supabase functions serve --no-verify-jwt --env-file supabase/.env.local
# Terminal 2: npx expo run:ios (native build — required after app.json scheme change in Step 1)

./run_tests.sh test_12_create_lobby.yaml
./run_tests.sh test_13_join_lobby.yaml
./run_tests.sh test_14_lobby_game.yaml
./run_tests.sh test_15_leave_lobby.yaml

# Full suite
./run_tests.sh

# Diff for Mac Claude review
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report each test result individually. Do not report success until all 15 pass. Do not commit — Mac Claude reviews the diff first.
