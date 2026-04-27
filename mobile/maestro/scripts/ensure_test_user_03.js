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
