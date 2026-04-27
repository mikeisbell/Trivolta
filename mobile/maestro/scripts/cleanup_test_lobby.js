// Deletes test lobby by LOBBY_ID. FK CASCADE handles all child rows.
var HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  'Content-Type': 'application/json'
}
if (LOBBY_ID) {
  http.delete(SUPABASE_URL + '/rest/v1/lobbies?id=eq.' + LOBBY_ID, { headers: HEADERS })
}
