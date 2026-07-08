# Spec: "Contas" — what must happen to reach 1st place / avoid paying the dinner (v0 only)

## Problem

Since the group stage ended, the leaderboard shows each player's **possible-rank range** (`Possível: #2 – #5`) and the locked green/red dinner halves. That tells everyone *whether* they're still in either fight — (1) who finishes 1st, (2) who avoids the dinner-paying half — but not **what has to happen** for it. The `minPodiumGap` bound distils the whole thing to a single number; the actual conditions ("basta a Argentina ficar fora do pódio") stay locked in whoever does the bracket math by hand.

The pool is watching every knockout game with dinner money on the line, and this is exactly when those conditions are wanted and computable: knockout rows carry no per-match predictions (`calcPts` needs a `pred`, which only group matches have), so **the only remaining scoring uncertainty is the final podium**. And critically, **podium points depend only on the `(champion, runner-up, third)` triple — never on the path through the matches**. That makes the podium triple, not the match bracket, the natural unit.

## Goal

- In the **expanded player row**, directly **above the "Pódio previsto" block**, one podium-framed sentence per still-open objective (1st place, dinner) for any non-observer with a live fight.
- Conditions are phrased over **podium-slot facts** — "a França vice-campeã", "a Argentina fora do pódio", "campeão: outro ou a Inglaterra" — the things people actually say, not match results.
- Describe the **smaller** of {achieves / fails} so a near-locked leader reads the few ways they *lose* it ("Só falhas o 1º se…") rather than dozens of ways they keep it.
- **Exact when the facts fully pin the outcome; honestly hedged otherwise** ("— depende de outros resultados"). Never falsely precise, and never a long list — hedge-only for the partial cases (curious players can work the rest out themselves).
- A player whose fate is closed on both fronts sees the row exactly as before. No "already guaranteed" banners.

**Scope: v0 only.** Additive expanded-row section. Coexists with the existing `minPodiumGap` possible-rank display (left unchanged — see Tie-break rule). Sits alongside `structural-podium-floor.md` and `tie-break-ladder-reorder.md`. Observers excluded — no dinner stake, their intra-observer "1st" is a vanity rank.

---

## Tie-break rule — exact scores are visual-only

The pool's agreed rule: **exact scores are a display tiebreak, never an actual one.** Two players level on total → champion pick → group points are **tied**, even if the UI prints one above the other because they have more exacts. So "reaching 1st" means *nobody is strictly ahead on the real criteria (total, champion pick, group points)* — a shared 1st counts.

This is why the feature uses its own comparator, **not** `classifyBoard`/`sameRank` (which include exacts and would wrongly split a tied pair):

```js
// index.html — the real tie-break, exact scores EXCLUDED. champKey already exists (the graded
// 0<null<10<20 champion-slot key from tie-break-ladder-reorder.md).
function contasCmp(a, b, ts) {
  return (a.total - b.total)
      || (champKey(a, ts) - champKey(b, ts))
      || ((a.gamePts ?? a.total) - (b.gamePts ?? b.total));   // no exacts term
}
```

**Worked example (why it matters).** Pedro picked França / Portugal(✝) / Espanha; Pedro Miguel picked França / Argentina / Espanha, same group points (218) but more exacts (11 vs 9). In Pedro's best podium (🥇França 🥈outro 🥉Espanha) both reach 238 — a true tie on total, champion and group points. Under `sameRank` (exacts included) Pedro is split off to #2 and shows *no* 1st-place fight; under `contasCmp` they **share 1st**, so Pedro correctly has a live fight (tied 1st in 25 of 87 podiums). The `minPodiumGap` range display already ignores exacts (it compares totals only), so it already says "Possível: #1" for Pedro — the fix aligns Contas with that, and **nothing in the rank/lock display changes.**

---

## The engine — reachable podium classes

`buildKoEngine()` (kept from the first cut) resolves the static bracket tree (`R32`/`R16`/`QF`/`SF` constants; `3P` = the two SF losers, `FIN` = the two SF winners) into a flat node list, marks each non-`isFinal` match as a **pending node** (live counts as pending — either side can still win), and returns `resolve(bitAt)` completing the bracket under a per-node winner choice. It's `null` (dormant) until the R32 is fully seeded, and Contas is gated to **≤ `CONTAS_MAX_PENDING` (10)** pending nodes so the `2^k` sweep stays a few ms.

### Podium classes with the OUTRO collapse

The key simplification. A team **nobody still-alive picked** scores a guaranteed 20 for everyone in whatever slot it lands, so its *identity* is irrelevant — collapse all such teams to a single sentinel `CONTAS_OUTRO`. Two full brackets that differ only in which unpicked team fills a slot are then **one scoring class**. `enumeratePodiumClasses`:

- sweeps all `2^k` bracket completions, maps each to `(champion, runner-up, third)` with unpicked teams → `OUTRO`, and dedups → the distinct **podium classes** (87 at the current QF-stage bracket, down from 256 raw completions);
- for each class builds a terminal `tournamentState`, scores every player `total = gamePts + calcPodiumPts(podiumArr, ts)`, ranks by `contasCmp`, and records per player:
  - **first**: `#{players strictly ahead} === 0` — shares 1st.
  - **pays**: `#{players strictly ahead} ≥ T` (`T = ⌊N/2⌋`) — bottom half. Tie-safe: a tie-group straddling the cutoff has one shared "ahead" count, so its members classify together (no split on a non-criterion).

`calcPodiumPts` / `calcPodiumSlotPts` / `champKey` are reused verbatim — scoring stays single-source (CLAUDE.md). Only the *ranking comparator* differs (exacts excluded), by design.

---

## Distillation — podium-slot facts

For the side being described (the smaller of {achieves, ¬achieves}), find the **necessary facts** — predicates true across *every* class in that set:

- Per relevant team X, the strongest true role from `CONTAS_ROLES` (`campeã` › `vice-campeã` / `em 3º` › `na final` › `no pódio` / `fora do pódio`), dropping any role a stronger kept role implies.
- A **champion-membership** fact when the champion is constrained, stated whichever way is shorter: `campeão: A ou B ou outro` vs `campeão não é A nem B`.

Then check **exactness**: if the classes satisfying *all* the facts number exactly the target set, the facts fully characterise it → state it plainly. Otherwise the facts are necessary-but-not-sufficient → append the hedge.

```
exact:    "{verb} se {facts joined by ' e '}"
partial:  "{verb} se {facts} — depende de outros resultados"
no facts: "{verb} em N de TOTAL cenários — depende de vários resultados"
```

`verb` carries polarity and which side is shown: `Ficas 1º` / `Só falhas o 1º` for 1st; `Não pagas` / `Só pagas` for the dinner. Facts capped at 4.

### Real output (current bracket, 87 classes)

```
🎯 João Maria   Ficas 1º se 🇫🇷 França vice-campeã e 🇦🇷 Argentina fora do pódio e
                🇪🇸 Espanha fora do pódio e campeão: outro ou 🏴 Inglaterra        (exact)
🎯 Pedro        Ficas 1º se 🇦🇷 Argentina fora do pódio e campeão não é 🇪🇸 Espanha
                nem 🇦🇷 Argentina — depende de outros resultados                    (partial)
🎯 Pedro Miguel Só falhas o 1º se campeão não é 🇫🇷 França nem 🇦🇷 Argentina —
                depende de outros resultados                                        (leader → danger side)
🎯 Zé Queirós   Só pagas … / Não pagas se 🇫🇷 França vice-campeã e 🇦🇷 Argentina
                campeã e 🇪🇸 Espanha e 🏴 Inglaterra fora do pódio                   (exact)
```

The `OUTRO` collapse and podium framing kill the near-duplicate lines the earlier match-path distiller produced.

---

## User-facing behaviour

Inside `lb-expand`, above "Pódio previsto", a `🎯 Contas` header + up to two muted sentences (`pc.first`, `pc.jantar`). No section at all for observers, pre-`groupStageComplete`, when the node gate trips, or when both objectives are closed — those rows render byte-identical to before.

## Data model / Backend

None. Pure `index.html` render logic over already-loaded `state.matches` / `state.allPodiums`.

## Implementation notes

### Files touched
- `index.html` only.

### Where the logic lives
- **`buildKoEngine()`** — bracket resolver (kept; null-team guard; dormant until R32 fully seeded).
- **`contasCmp`** — the exacts-excluded comparator (the whole point of the tie-break rule).
- **`enumeratePodiumClasses(rows, engine, eliminated)`** — the `2^k` sweep → OUTRO-collapsed classes + per-player first/pays sets.
- **`CONTAS_ROLES` / `contasFacts` / `contasSentence`** — necessary-fact distillation and the polarity/exactness sentence.
- **`contasData(rows)`** — memoized on an all-matches + player-aggregate fingerprint (group results feed R32 slot pinning, so they're in the key); **`playerConditions`** — lazy per-row sentences.
- **`classifyBoard(rows, ts)`** — still the leaderboard's own rank/half classifier (with exacts + cutoff-tie neutralisation); Contas deliberately does **not** use it (different tie rule). The extraction from the first cut is retained since `renderLeaderboard` and `boardAsOf` share it.
- **No change** to `calcPts` / `calcPodiumPts` / `calcPodiumSlotPts` / `compareStandings` / `sameRank` / `minPodiumGap` or any display of rank/locks.

---

## Out of scope

- **Reconciling `minPodiumGap`/`bestRank` with the exact engine** — the range display keeps its total-only bound. It already ignores exacts (so it agrees with Contas that Pedro can reach 1st); its looseness on the champion/group-points tiebreaks is a separate, pre-existing imprecision, and the pool rules explicitly keep the ranking system unchanged.
- **Listing the favourable podiums** — hedge-only for partial cases, by decision.
- **Observers; "already guaranteed" confirmations; objectives beyond the two; earlier-round activation (the ≤10-node gate is the floor); v1 (`goalgut/`).**

## Reversibility

Pure additive render behind three gates (`groupStageComplete`, node count ≤ 10, objective-open). Revert by deleting the Contas helpers and the section; `classifyBoard` stays (independently correct, shared by the leaderboard).

## Testing

Verified pre-ship with a Node harness that extracts the scoring + engine slice from `index.html`, runs it on the real DB state, and asserts: distinct classes enumerate cleanly (87 at k=8); no player is both "first" and "pays" in one class; every class has ≥1 first-place holder; and the generated sentences match an independently-written prototype. The exacts-excluded rule was validated against the Pedro/Pedro-Miguel worked example above. Live, after each real result the section must recompute (memo fingerprint) and conditions only ever *narrow*.
