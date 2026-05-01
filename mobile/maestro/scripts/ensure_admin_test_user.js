// Ensures testuser_maestro_admin exists in Supabase auth + profiles AND
// has app_metadata.role = 'admin' so the JWT carries the admin claim.
// Sets output.adminUserId to the auth user UUID.
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
  if (users[i].email === 'testuser_maestro_admin@trivolta-test.com') {
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
      email: 'testuser_maestro_admin@trivolta-test.com',
      password: 'TestPassword123!',
      email_confirm: true
    })
  })
  var created = JSON.parse(createResp.body)
  userId = created.id

  http.post(SUPABASE_URL + '/rest/v1/profiles', {
    headers: HEADERS,
    body: JSON.stringify({ id: userId, username: 'maestroadmin' })
  })
}

// Always (re)grant admin so the role survives db resets that leave the
// user record in place but wipe metadata. PUT to admin users endpoint
// merges raw_app_meta_data on the server.
http.put(SUPABASE_URL + '/auth/v1/admin/users/' + userId, {
  headers: HEADERS,
  body: JSON.stringify({ app_metadata: { role: 'admin' } })
})

output.adminUserId = userId
