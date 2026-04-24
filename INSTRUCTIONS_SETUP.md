# INSTRUCTIONS_SETUP.md — Trivolta project scaffold

## Task
Scaffold the complete Trivolta project: an Expo React Native mobile app and Supabase backend
(Edge Functions + database migrations). TypeScript only — no Python, no separate server.

## Verifiable objective
When complete, all of the following pass:
- `cd mobile && npx tsc --noEmit` exits with 0 errors
- `cd mobile && npx expo start --non-interactive` starts without error
- `supabase functions serve --no-verify-jwt` starts without error
- `git diff HEAD > /tmp/trivolta_diff.txt` captures the full scaffold

## Constraints
- Read CLAUDE.md before writing a single file
- TypeScript only — no Python, no separate server process
- Mobile app never imports the Anthropic SDK — Edge Functions only
- All secrets via Supabase secrets or `.env.local` — never hardcoded
- Do not wire navigation between screens yet — structure only
- Do not install AdMob — add a comment placeholder only

---

## Step 1 — Install Supabase CLI (if not already installed)

```bash
brew install supabase/tap/supabase
supabase --version
```

---

## Step 2 — Initialise Supabase in the repo root

```bash
cd /Users/mizzy/Developer/Trivolta
supabase init
```

This creates `supabase/` with `config.toml`. Do not modify `config.toml` yet.

---

## Step 3 — Create the database migration

Create `supabase/migrations/20240101000000_initial_schema.sql`:

```sql
-- Users (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique not null,
  avatar_url text,
  total_score integer default 0,
  best_streak integer default 0,
  games_played integer default 0,
  created_at timestamptz default now()
);

-- Solo game scores
create table public.scores (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  category text not null,
  score integer not null,
  correct_count integer not null,
  total_questions integer not null,
  best_streak integer not null,
  played_at timestamptz default now()
);

-- Lobbies
create table public.lobbies (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  host_id uuid references public.profiles(id) not null,
  category text not null,
  status text default 'waiting' check (status in ('waiting', 'active', 'finished')),
  max_players integer default 8,
  created_at timestamptz default now()
);

-- Lobby players
create table public.lobby_players (
  lobby_id uuid references public.lobbies(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (lobby_id, user_id)
);

-- Questions for a lobby game (generated once before game start)
create table public.lobby_questions (
  id uuid default gen_random_uuid() primary key,
  lobby_id uuid references public.lobbies(id) on delete cascade not null,
  question_index integer not null,
  question text not null,
  answers jsonb not null,
  correct_index integer not null,
  explanation text not null,
  difficulty text not null,
  unique (lobby_id, question_index)
);

-- Game session timing (server-authoritative timestamps)
create table public.game_sessions (
  id uuid default gen_random_uuid() primary key,
  lobby_id uuid references public.lobbies(id) on delete cascade not null,
  question_index integer not null,
  starts_at timestamptz not null,
  unique (lobby_id, question_index)
);

-- Player answers in lobby games
create table public.lobby_answers (
  lobby_id uuid references public.lobbies(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  question_index integer not null,
  answer_index integer not null,
  answered_at timestamptz default now(),
  primary key (lobby_id, user_id, question_index)
);

-- RLS
alter table public.profiles enable row level security;
alter table public.scores enable row level security;
alter table public.lobbies enable row level security;
alter table public.lobby_players enable row level security;
alter table public.lobby_questions enable row level security;
alter table public.game_sessions enable row level security;
alter table public.lobby_answers enable row level security;

create policy "profiles_read_all" on public.profiles for select using (true);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

create policy "scores_read_all" on public.scores for select using (true);
create policy "scores_insert_own" on public.scores for insert with check (auth.uid() = user_id);

create policy "lobbies_read" on public.lobbies for select using (auth.role() = 'authenticated');
create policy "lobbies_insert" on public.lobbies for insert with check (auth.uid() = host_id);
create policy "lobbies_update_host" on public.lobbies for update using (auth.uid() = host_id);

create policy "lobby_players_read" on public.lobby_players for select using (auth.role() = 'authenticated');
create policy "lobby_players_insert" on public.lobby_players for insert with check (auth.uid() = user_id);

create policy "lobby_questions_read" on public.lobby_questions for select using (auth.role() = 'authenticated');
create policy "game_sessions_read" on public.game_sessions for select using (auth.role() = 'authenticated');

create policy "lobby_answers_read" on public.lobby_answers for select using (auth.role() = 'authenticated');
create policy "lobby_answers_insert" on public.lobby_answers for insert with check (auth.uid() = user_id);

-- Leaderboard view (top 50, last 30 days)
create view public.leaderboard as
  select
    p.id,
    p.username,
    p.avatar_url,
    sum(s.score) as total_score,
    count(s.id) as games_played
  from public.profiles p
  join public.scores s on s.user_id = p.id
  where s.played_at > now() - interval '30 days'
  group by p.id, p.username, p.avatar_url
  order by total_score desc
  limit 50;
```

---

## Step 4 — Create Edge Functions

### 4a — solo-question

Create `supabase/functions/solo-question/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function difficultyFromStreak(streak: number): string {
  if (streak >= 5) return 'hard'
  if (streak >= 2) return 'medium'
  return 'easy'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { category, streak = 0 } = await req.json()
    const difficulty = difficultyFromStreak(streak)
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

    const prompt = `Generate a trivia question about "${category}" at ${difficulty} difficulty.
Return ONLY valid JSON with this exact shape — no markdown, no explanation:
{
  "question": "the question text",
  "answers": ["correct answer", "wrong 1", "wrong 2", "wrong 3"],
  "correct_index": 0,
  "explanation": "one sentence explanation",
  "difficulty": "${difficulty}",
  "category": "${category}"
}
Pre-shuffle the answers array. correct_index must point to the correct answer after shuffling.`

    const attempt = async () => {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        system: 'You are a trivia question generator. Return ONLY valid JSON. No markdown.',
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      return JSON.parse(text.trim())
    }

    let result
    try { result = await attempt() } catch { result = await attempt() }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
```

### 4b — generate-questions (lobby)

Create `supabase/functions/generate-questions/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { lobby_id, category, difficulty = 'medium' } = await req.json()
    if (!lobby_id || !category) {
      return new Response(JSON.stringify({ error: 'lobby_id and category required' }), {
        status: 400, headers: corsHeaders,
      })
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const questions = []
    for (let i = 0; i < 10; i++) {
      const prompt = `Generate trivia question ${i + 1} of 10 about "${category}" at ${difficulty} difficulty.
Return ONLY valid JSON — no markdown:
{
  "question": "the question text",
  "answers": ["correct answer", "wrong 1", "wrong 2", "wrong 3"],
  "correct_index": 0,
  "explanation": "one sentence explanation",
  "difficulty": "${difficulty}",
  "category": "${category}"
}
Pre-shuffle the answers. correct_index must point to correct answer after shuffling.`

      const attempt = async () => {
        const msg = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 400,
          system: 'You are a trivia question generator. Return ONLY valid JSON. No markdown.',
          messages: [{ role: 'user', content: prompt }],
        })
        const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
        return JSON.parse(text.trim())
      }

      let q
      try { q = await attempt() } catch { q = await attempt() }
      questions.push(q)
    }

    const rows = questions.map((q, i) => ({
      lobby_id,
      question_index: i,
      question: q.question,
      answers: q.answers,
      correct_index: q.correct_index,
      explanation: q.explanation,
      difficulty: q.difficulty,
    }))

    const { error } = await supabase.from('lobby_questions').insert(rows)
    if (error) throw error

    return new Response(JSON.stringify({ success: true, count: questions.length }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
```

### 4c — create-lobby

Create `supabase/functions/create-lobby/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const { category } = await req.json()
    if (!category) {
      return new Response(JSON.stringify({ error: 'category required' }), { status: 400, headers: corsHeaders })
    }

    // Generate unique room code
    let code = generateRoomCode()
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await supabase.from('lobbies').select('id').eq('code', code).single()
      if (!existing) break
      code = generateRoomCode()
    }

    const { data: lobby, error: lobbyError } = await supabase
      .from('lobbies')
      .insert({ code, host_id: user.id, category, max_players: 8 })
      .select()
      .single()

    if (lobbyError) throw lobbyError

    // Add host as first player
    await supabase.from('lobby_players').insert({ lobby_id: lobby.id, user_id: user.id })

    return new Response(JSON.stringify({ lobby }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
```

---

## Step 5 — Initialise the Expo mobile app

```bash
cd /Users/mizzy/Developer/Trivolta
npx create-expo-app mobile --template blank-typescript
cd mobile
npx expo install expo-router react-native-safe-area-context react-native-screens \
  expo-linking expo-constants expo-status-bar @supabase/supabase-js \
  @react-native-async-storage/async-storage react-native-url-polyfill
```

---

## Step 6 — Create mobile app structure

### 6a — Shared types: `mobile/lib/types.ts`

```typescript
export type QuestionResponse = {
  question: string
  answers: string[]
  correct_index: number
  explanation: string
  difficulty: 'easy' | 'medium' | 'hard'
  category: string
}

export type Lobby = {
  id: string
  code: string
  host_id: string
  category: string
  status: 'waiting' | 'active' | 'finished'
  max_players: number
  created_at: string
}

export type LobbyPlayer = {
  lobby_id: string
  user_id: string
  joined_at: string
}

export type LobbyQuestion = {
  id: string
  lobby_id: string
  question_index: number
  question: string
  answers: string[]
  correct_index: number
  explanation: string
  difficulty: string
}

export type GameSession = {
  id: string
  lobby_id: string
  question_index: number
  starts_at: string
}
```

### 6b — Supabase client: `mobile/lib/supabase.ts`

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import 'react-native-url-polyfill/auto'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
```

### 6c — API helpers: `mobile/lib/api.ts`

```typescript
import { supabase } from './supabase'
import type { QuestionResponse } from './types'

const FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1'

async function callFunction(name: string, body: object): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

export async function generateSoloQuestion(
  category: string,
  streak: number
): Promise<QuestionResponse> {
  const res = await callFunction('solo-question', { category, streak })
  if (!res.ok) throw new Error(`Question generation failed: ${res.status}`)
  return res.json()
}

export async function createLobby(category: string) {
  const res = await callFunction('create-lobby', { category })
  if (!res.ok) throw new Error(`Create lobby failed: ${res.status}`)
  return res.json()
}

export async function generateLobbyQuestions(
  lobby_id: string,
  category: string,
  difficulty: string
) {
  const res = await callFunction('generate-questions', { lobby_id, category, difficulty })
  if (!res.ok) throw new Error(`Generate lobby questions failed: ${res.status}`)
  return res.json()
}
```

### 6d — Environment files

Create `mobile/.env.local`:
```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<paste local anon key after running supabase start>
```

Create `mobile/.env.example`:
```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 6e — Screens (placeholder structure only)

Create each file in `mobile/app/`. Each is a functional TypeScript component returning
a `<View>` with a `<Text>` label. No logic, no navigation wiring yet.

```
mobile/app/
  _layout.tsx             root Stack layout (expo-router)
  index.tsx               HomeScreen
  question.tsx            QuestionScreen
  results.tsx             ResultScreen
  leaderboard.tsx         LeaderboardScreen
  profile.tsx             ProfileScreen
  custom-category.tsx     CustomCategoryScreen
  lobby/
    create.tsx            CreateLobbyScreen
    join.tsx              JoinLobbyScreen
    waiting.tsx           LobbyWaitingScreen
    game.tsx              LobbyGameScreen
    results.tsx           LobbyResultScreen
```

---

## Step 7 — Root .gitignore

Create `.gitignore` at `/Users/mizzy/Developer/Trivolta/`:

```
# Environment
.env
.env.local
*.env.local

# Node / Expo
node_modules/
.expo/
dist/

# Supabase local
supabase/.branches/
supabase/.temp/

# OS
.DS_Store

# Diff output
/tmp/trivolta_diff.txt
```

---

## Verification

Run in order. Fix any failure before proceeding to the next:

```bash
# 1. Mobile TypeScript check
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit

# 2. Supabase functions check
cd /Users/mizzy/Developer/Trivolta
supabase functions serve --no-verify-jwt 2>&1 | head -20

# 3. Capture full diff
git diff HEAD > /tmp/trivolta_diff.txt
echo "Lines changed: $(wc -l < /tmp/trivolta_diff.txt)"
```

Report the result of each command. Do not report success until all three pass.
