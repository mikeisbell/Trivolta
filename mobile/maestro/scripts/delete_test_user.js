// Deletes test users via Supabase admin API before each signup test run.
// SUPABASE_URL and SUPABASE_SERVICE_KEY are injected by Maestro's env block —
// see test_02_sign_up.yaml and maestro/.env.maestro.
var HEADERS = { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY }
var TARGETS = [
  'testuser_maestro_02@trivolta-test.com',
  'signup_test@trivolta-test.com',
]

var resp = http.get(SUPABASE_URL + '/auth/v1/admin/users', { headers: HEADERS })
var body = JSON.parse(resp.body)
var userList = body.users || body

for (var i = 0; i < userList.length; i++) {
  for (var j = 0; j < TARGETS.length; j++) {
    if (userList[i].email === TARGETS[j]) {
      http.delete(SUPABASE_URL + '/auth/v1/admin/users/' + userList[i].id, { headers: HEADERS })
      break
    }
  }
}
