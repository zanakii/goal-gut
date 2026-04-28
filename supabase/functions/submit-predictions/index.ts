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
    const { player_id, pin, predictions, podium } = await req.json()

    if (!player_id || !pin || !predictions?.length) {
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

    // Force player_id from the verified PIN — never trust the client-supplied value
    // on each row (service role bypasses RLS, so this is the only check).
    const safeRows = predictions.map((p: { match_id: number; score_a: number; score_b: number }) => ({
      player_id,
      match_id: p.match_id,
      score_a: p.score_a,
      score_b: p.score_b,
    }))

    const { error: predError } = await supabase
      .from('predictions')
      .upsert(safeRows, { onConflict: 'player_id,match_id' })

    if (predError) throw new Error(predError.message)

    // Upsert podium if all three places are filled
    if (podium?.first_place && podium?.second_place && podium?.third_place) {
      const { error: podiumError } = await supabase
        .from('podium_predictions')
        .upsert({
          player_id,
          first_place: podium.first_place,
          second_place: podium.second_place,
          third_place: podium.third_place,
        }, { onConflict: 'player_id' })
      if (podiumError) throw new Error(podiumError.message)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
