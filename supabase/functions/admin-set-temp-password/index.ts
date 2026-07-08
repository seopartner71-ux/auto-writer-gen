import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { email, password, secret } = await req.json()
    if (secret !== Deno.env.get('ADMIN_ONE_OFF_SECRET')) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: list, error: le } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    if (le) throw le
    const u = list.users.find((x: any) => x.email?.toLowerCase() === String(email).toLowerCase())
    if (!u) return new Response(JSON.stringify({ error: 'user_not_found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const { error } = await admin.auth.admin.updateUserById(u.id, { password })
    if (error) throw error
    return new Response(JSON.stringify({ ok: true, user_id: u.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})