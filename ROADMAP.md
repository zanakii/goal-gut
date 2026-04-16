# Roadmap

## v1.0 — WC2026 Friends Edition (current)

A private predictions pool for a closed group of friends. Intentionally simple: single HTML file, PIN-based identity, manually seeded players.

**What's in scope:**
- 72 group-stage matches seeded in Supabase
- Predictions submitted via PIN-protected form
- Leaderboard with cumulative points chart
- Automated result fetching via GitHub Actions + api-football.com
- Hosted on Vercel at goalgut.gg

**Known limitations (by design):**
- No self-registration — players are manually added to the DB
- PIN verification is UX-only; security relies on the `submit-predictions` Edge Function
- Single pool — no concept of separate leagues or groups
- RLS is partially bypassed via service role key in the Edge Function
- Frontend is a single HTML file — not maintainable at scale

---

## v2.0 — Public Edition

Tracked under the [`v2.0-public-edition`](https://github.com/zanakii/goal-gut/milestone) milestone.

### #5 — Auth
Replace the PIN system with **Supabase Auth magic links**. Each user gets a real account tied to an email address. This unlocks proper RLS enforcement — Supabase can verify `auth.uid()` on every request, removing the need for the Edge Function workaround.

Key decisions:
- Magic link (no password) is the right fit for casual users
- `players` table becomes linked to `auth.users` via `user_id`
- PIN modal and `submit-predictions` Edge Function can be retired

### #6 — Multi-tenancy
Introduce a **leagues layer** so multiple independent pools can coexist. A league is a group of users predicting on the same tournament.

Proposed schema additions:
```
tournaments  (id, name, season, api_league_id)
leagues      (id, tournament_id, name, invite_code, owner_id)
league_members (league_id, user_id, display_name)
predictions  (+ league_id, user_id replacing player_id)
podium_predictions (+ league_id, user_id)
```

RLS policies then scope all reads and writes to leagues the authenticated user belongs to — no bypass needed.

### #7 — Front-end
Move from a single HTML file to a proper framework. **SvelteKit** or **Next.js** are the natural choices given the Supabase ecosystem.

Key decisions:
- Extract scoring logic (`calcPts`, `isExact`) into a shared module reused across views
- UI concepts (match cards, leaderboard, predictions view) map cleanly to components
- Result-fetching workflow stays in GitHub Actions but becomes tournament-aware

---

## Sequencing

```
Now            WC2026 friends edition — ship and enjoy it
Post-WC2026    Tag v1.0-wc2026-friends, freeze current Supabase project
2027–2028      Build v2: auth → multi-tenancy → new frontend (in that order)
WC2030 -6m     Public launch
```

**Order matters:** auth must come before multi-tenancy (RLS depends on real user identities), and both must be stable before investing in a new frontend.

---

## Preserving v1

When WC2026 ends:

```bash
git tag v1.0-wc2026-friends
git push origin v1.0-wc2026-friends
```

The current Supabase project stays live as a read-only record. v2 starts from a new repo and a new Supabase project.
