// Deletes all waiting lobbies hosted by HOST_EMAIL.
// Used to clean up after tests where the host has no UI leave button.
var HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  'Content-Type': 'application/json'
}
var BASE = SUPABASE_URL + '/rest/v1'

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

if (hostUserId) {
  http.delete(BASE + '/lobbies?host_id=eq.' + hostUserId + '&status=eq.waiting', { headers: HEADERS })
}
