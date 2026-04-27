// Creates full game lobby: resolves host from HOST_EMAIL, adds GUEST_USER_ID, seeds 10 questions.
// Optional ROOM_CODE env var (default 'GAME').
// Sets output.lobbyId.
var HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  'Content-Type': 'application/json'
}
var BASE = SUPABASE_URL + '/rest/v1'

var CODE = (typeof ROOM_CODE !== 'undefined' && ROOM_CODE) ? ROOM_CODE : 'GAME'

// Remove any stale lobby with this code from previous failed runs
http.delete(BASE + '/lobbies?code=eq.' + CODE, { headers: HEADERS })

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
    code: CODE,
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
    answers: ['Mars', 'Venus', 'Jupiter', 'Saturn'],
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
