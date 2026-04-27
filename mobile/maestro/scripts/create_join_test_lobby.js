// Creates a waiting lobby with HOST_USER_ID only — no guest, no questions.
// Sets output.lobbyId, output.roomCode.
var HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  'Content-Type': 'application/json'
}
var BASE = SUPABASE_URL + '/rest/v1'

// Remove any stale lobby with this room code from previous failed runs
http.delete(BASE + '/lobbies?code=eq.' + ROOM_CODE, { headers: HEADERS })

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
