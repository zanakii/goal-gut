# Spec: Fix "Melhor 3º" Persisting After Tiebreaks Are Resolved

## Bug description

After a player resolves all tiebreak prompts in the bracket view, at least one R32 slot still
displays "Melhor 3º" instead of a team name. The slot's winner picker falls back to the full
48-team dropdown, making the bracket unusable for that match.

## Root cause

`assignBest3rdsToSlots()` uses a **greedy first-fit** algorithm: it iterates the 8 R32 slots
in ascending numeric order (1, 4, 6, 7, 8, 9, 12, 14) and for each slot assigns the highest-ranked
remaining eligible third-place team. This greedy approach can exhaust eligible teams for a later
slot even when a valid full assignment exists.

### Concrete failure example

Suppose the top 8 third-place teams come from groups E, H, I, J, K, G, B, A (sorted best→worst).

Greedy walks through slots in order:

| Slot | Eligible groups | Greedy picks | Remaining |
|------|----------------|--------------|-----------|
| 1    | A,B,C,D,F      | B            | E,H,I,J,K,G,A |
| 4    | C,D,F,G,H      | H            | E,I,J,K,G,A |
| 6    | C,E,F,H,I      | E            | I,J,K,G,A |
| 7    | E,H,I,J,K      | I (K skipped)| J,K,G,A |
| 8    | B,E,F,I,J      | J            | K,G,A |
| 9    | A,E,H,I,J      | A            | K,G |
| 12   | E,F,G,I,J      | G            | K |
| 14   | D,E,I,J,L      | **none** ← K is not in this list | — |

Slot 14 is unassigned and K is stranded — `best3rdsAssignment[14]` is `undefined`.

A valid assignment exists: assigning K to slot 7, then J to slot 14, G to slot 12 etc. The
greedy missed it because when it processed slot 7, I ranked higher than K and was picked first.

### Why this appears after tiebreaks are resolved

Tiebreaks determine which team occupies 3rd place in each group, which in turn determines the
top-8 pool fed into `assignBest3rdsToSlots`. Once tiebreaks are all resolved, the pool is
stable — but the assignment algorithm can still fail, so "Melhor 3º" persists.

---

## Fix: replace greedy with backtracking

The problem is a small bipartite matching (8 teams, 8 slots). Backtracking is correct, fast,
and simple to implement inline.

```js
function assignBest3rdsToSlots(best3rds) {
  const slots = Object.keys(THIRD_SLOT_GROUPS).map(Number);   // [1,4,6,7,8,9,12,14]
  const result = {};

  function backtrack(slotIdx, used) {
    if (slotIdx === slots.length) return true;
    const slot = slots[slotIdx];
    const eligible = THIRD_SLOT_GROUPS[slot];
    for (const candidate of best3rds) {
      if (!used.has(candidate.team) && eligible.includes(candidate.group)) {
        result[slot] = candidate.team;
        used.add(candidate.team);
        if (backtrack(slotIdx + 1, used)) return true;
        delete result[slot];
        used.delete(candidate.team);
      }
    }
    return false;
  }

  backtrack(0, new Set());
  return result;
}
```

`best3rds` is already sorted best→worst, so the backtracker naturally tries the highest-ranked
eligible team first at each slot and only backtracks if it leads to a dead end. In practice the
search terminates in the first few tries for realistic prediction sets.

---

## Secondary improvement: slot ordering

To minimise backtracking, sort slots by number of eligible teams ascending before starting
(most-constrained-variable heuristic). Slots eligible for fewer teams (slot 7 includes K which
appears nowhere else; slot 14 includes L which appears nowhere else) should be assigned first.

```js
const slots = Object.keys(THIRD_SLOT_GROUPS)
  .map(Number)
  .sort((a, b) => THIRD_SLOT_GROUPS[a].length - THIRD_SLOT_GROUPS[b].length);
```

All slot groups have exactly 5 entries in the current structure, so this has no effect today —
but is correct to include for robustness.

---

## Files to modify

- `index.html` — replace `assignBest3rdsToSlots()` (lines ~611–619) with the backtracking
  version above
- No state changes, no DB changes, no Edge Function changes
