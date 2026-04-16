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

    // Insert predictions (service role bypasses RLS)
    const { error: predError } = await supabase
      .from('predictions')
      .insert(predictions)

    if (predError) throw new Error(predError.message)

    // Insert podium if all three places are filled
    if (podium?.first_place && podium?.second_place && podium?.third_place) {
      const { error: podiumError } = await supabase
        .from('podium_predictions')
        .insert({ player_id, ...podium })
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
