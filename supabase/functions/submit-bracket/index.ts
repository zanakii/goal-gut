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
    const { player_id, pin, bracket } = await req.json()

    if (!player_id || !pin || !bracket?.length) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify PIN server-side
    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, code')
      .eq('id', player_id)
      .single()

    if (playerError || !player) {
      return new Response(JSON.stringify({ error: 'Player not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (player.code !== pin) {
      return new Response(JSON.stringify({ error: 'Código incorrecto' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Server-side deadline check
    const { data: cfg } = await supabase
      .from('tournament_config')
      .select('value')
      .eq('key', 'submission_deadline')
      .single()

    if (cfg?.value && new Date() > new Date(cfg.value)) {
      return new Response(JSON.stringify({ error: 'Prazo de submissão encerrado' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Upsert bracket picks
    const rows = bracket.map((b: { round: string; slot: number; picked_team: string }) => ({
      player_id,
      round: b.round,
      slot: b.slot,
      picked_team: b.picked_team,
      updated_at: new Date().toISOString()
    }))

    const { error: bracketError } = await supabase
      .from('bracket_predictions')
      .upsert(rows, { onConflict: 'player_id,round,slot' })

    if (bracketError) throw new Error(bracketError.message)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
