import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Check deadline server-side so the client cannot spoof a post-deadline request
    const { data: cfg } = await supabase
      .from('tournament_config')
      .select('value')
      .eq('key', 'submission_deadline')
      .single()

    const deadlinePassed = cfg?.value ? new Date() > new Date(cfg.value) : false

    if (deadlinePassed) {
      // Post-deadline: return all predictions without authentication
      const [predsRes, poduimsRes, bracketsRes] = await Promise.all([
        supabase.from('predictions').select('*'),
        supabase.from('podium_predictions').select('*'),
        supabase.from('bracket_predictions').select('*'),
      ])
      return new Response(JSON.stringify({
        predictions: predsRes.data || [],
        podiums: poduimsRes.data || [],
        brackets: bracketsRes.data || [],
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Pre-deadline: require player_id + pin
    let body: { player_id?: number; pin?: string } = {}
    try { body = await req.json() } catch (_) { /* empty body is ok */ }

    const { player_id, pin } = body

    if (!player_id || !pin) {
      return new Response(JSON.stringify({ error: 'missing_credentials' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify PIN
    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, code')
      .eq('id', player_id)
      .single()

    if (playerError || !player || player.code !== pin) {
      return new Response(JSON.stringify({ error: 'invalid_pin' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Return only this player's own data
    const [predsRes, podiumRes, bracketRes] = await Promise.all([
      supabase.from('predictions').select('*').eq('player_id', player_id),
      supabase.from('podium_predictions').select('*').eq('player_id', player_id),
      supabase.from('bracket_predictions').select('*').eq('player_id', player_id),
    ])

    return new Response(JSON.stringify({
      predictions: predsRes.data || [],
      podiums: podiumRes.data || [],
      brackets: bracketRes.data || [],
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
