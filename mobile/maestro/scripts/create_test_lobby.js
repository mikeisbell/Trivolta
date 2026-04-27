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
output.roomCode = roomCode
