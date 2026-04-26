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

export type Profile = {
  id: string
  username: string
  avatar_url: string | null
  total_score: number
  best_streak: number
  games_played: number
  created_at: string
}

export type UserStats = {
  profile: Profile
  rank: number | null
  totalScore: number
  gamesPlayed: number
  bestStreak: number
  accuracy: number
}

export type AnswerState = 'unanswered' | 'correct' | 'wrong' | 'timeout'

export type GameResult = {
  category: string
  score: number
  correctCount: number
  totalQuestions: number
  bestStreak: number
}
