# Spec: Matches tab — chronological order + auto-scroll to live (v0 only)

## Problem

`renderMatches` always groups the list by `group_letter` (`index.html:1488`), and the only
ordering knob is the status filter Todos / Jogados / Por jogar (`index.html:1570`) — there is
**no chronological view and no live filter**. Group-grouping is right for *Prognósticos* (you
fill picks group by group) but wrong for *Jogos* during the tournament: to find the match kicking
off right now, you have to know which group it's in and scroll to that block. On a busy match day
with games every couple of hours, the most-wanted card — the live or next game — is buried.

## Goal

- **Make the default Matches view a single chronological list** (earliest → latest), with day
  separators.
- **Auto-scroll to the current/next game** when the tab opens, so live action is on screen
  immediately.
- **Keep the group letters as optional filters** — picking a letter still narrows to that group;
  "Fase Final" still owns the knockouts.

**Scope: v0 only.** Builds on
[`_archive/matches-tab-fase-final-knockout-view.md`](_archive/matches-tab-fase-final-knockout-view.md)
— the `effectiveFilter` / `groupFilterTouched` machinery and the Fase Final default stay exactly
as specced there.

---

## User-facing behaviour

### "Todos" becomes a chronological list

Today the group-filter row is `[Todos] [A] [B] … [L] [Fase Final]`, where "Todos" renders group
blocks. Change **only** what "Todos" shows — a flat, time-ordered list with day separators. The
group letters and Fase Final are untouched.

| `effectiveFilter` | Main area |
|-------------------|-----------|
| `"all"` (Todos) | **All group matches, one chronological list**, day-separated — *changed* |
| `"A"`…`"L"` | That group's matches (unchanged) |
| `"FINAL"` | Knockouts grouped by stage (unchanged, from the Fase Final spec) |

Day separators reuse the kickoff date already on every card:

```
── Qui 11 Jun ──────────────
 18:00  🇲🇽 México   1 - 0  🇨🇦 Canadá        ✓ 0
 21:00  🇧🇷 Brasil   2 - 2  🇷🇸 Sérvia   AO VIVO
── Sex 12 Jun ──────────────
 17:00  🇵🇹 Portugal   vs   🇲🇦 Marrocos
```

Sort: the group matches by `new Date(m.kickoff)` ascending — the comparator already used
elsewhere (`index.html:355`, `1843`). Cards are otherwise the existing markup
(`index.html:1504`), still clickable to `matchDetail` once played. The `statusFilter` (Todos /
Jogados / Por jogar) composes as today — it just filters the flat list instead of the blocks.

A separator is emitted whenever `m.kickoff.split("T")[0]` changes from the previous row; the
label is a weekday + short-date (`fmtShort`-style). The empty-result placeholder
(`index.html:1529`) is unchanged.

### Auto-scroll to current/next

On entering the Matches tab, scroll the **anchor card** into view: the first **live** match, or
if none is live, the first **upcoming** match (earliest kickoff with `score_a === null`). If every
game is finished, no scroll — staying at the top is the natural "review" position.

```js
const anchor = sorted.find(isLive) || sorted.find(m => m.score_a === null);
```

Give that card `id="match-anchor"` and, after the view mounts:

```js
requestAnimationFrame(() =>
  document.getElementById('match-anchor')?.scrollIntoView({ block: 'center' }));
```

**Scroll only on tab entry, not on every re-render.** The live poller refreshes state every
minute (`loadData`), which re-renders Matches; auto-scrolling on each refresh would yank the page
out from under you mid-read. Gate with a module-level flag set when navigating *to* matches and
consumed on the next render:

```js
// changeView (index.html:1391): when newView === "matches", __matchesNeedScroll = true
// renderMatches: after building the list, if __matchesNeedScroll { schedule scroll; __matchesNeedScroll = false }
```

Auto-scroll applies to the chronological "Todos" view; on a group-letter view the anchor may not
exist in the DOM → the optional-chained call is a harmless no-op.

---

## Data model / Backend

None. `index.html` render only.

## Implementation notes

### Files touched
- `index.html` only.

### Where the logic lives
- **Chronological branch**: in `renderMatches` (`index.html:1467`), when `effectiveFilter ===
  "all"`, build a single time-sorted list with day separators instead of the `grouped`-by-letter
  blocks (`index.html:1488-1528`). The group-letter and FINAL branches are unchanged.
- **Day separators**: derive from `m.kickoff.split("T")[0]`; render a labelled divider when the
  date changes.
- **Anchor + scroll**: compute `anchor` from the sorted list; tag its card `id="match-anchor"`;
  schedule the `scrollIntoView` via the `__matchesNeedScroll` flag set in `changeView`
  (`index.html:1391`).

### Order of work
1. Add the chronological flat-list branch for `effectiveFilter === "all"` with day separators.
2. Compute the anchor; add `id="match-anchor"`.
3. Wire `__matchesNeedScroll` in `changeView` + the post-render scroll; consume it on render.

---

## Out of scope
- Reordering the group-letter views (they stay grouped — one group, natural order).
- Touching Fase Final ordering (stage-grouped by design).
- A dedicated "Ao Vivo" filter button — chronological + auto-scroll already lands you on the live
  game; a separate live filter is redundant. (Revisit only if a match day ever has many
  simultaneous live games.)
- The Prognósticos tab — keeps group grouping; that's correct for picking.
- v1 (`goalgut/`).

## Reversibility

Render-only. Revert by restoring the group-blocks branch for "Todos" and removing the
anchor/scroll wiring.

## Testing

Live-testable now (group stage is running). Verify:

- Opening Jogos lands centered on the live game, or the next upcoming if none is live.
- Day separators read correctly (kickoffs already render in Lisbon time).
- The 1-minute poll refresh does **not** re-scroll while you're reading.
- Group-letter filters still narrow correctly and don't auto-scroll disruptively.
- A finished-only state stays at the top.
