# Memory Index

- [Workout log contract](workout-log-contract.md) — VERIFIED add-workout backend contract; the user's architecture doc was wrong (no workout_sessions table, 42d not 45d, session-level integer RPE, remark on first row only)

- [Client Threads backend](client-threads-backend.md) — DB objects (conversations.client_id, type 'client', RPC get_or_create_client_thread) exist only in live Supabase, not in any repo
- [Coach workspace](coach-workspace.md) — native coach (head-of-trainers) dashboard: scope pattern, role plumbing, coach test account, PostgREST 1000-row cap gotcha
- [Ops workspace](ops-workspace.md) — native ops dashboard: leads stage-dialog contracts, RPC guards (spam/hold-reply/target-note), escalation count modes, no ops test password
- [Admin workspace](admin-workspace.md) — native admin dashboard: super-admin KPI RPCs, 7 alert derivations (all live-verified), admin creds, isPending-vs-isLoading offline gotcha
- [Doctor workspace](doctor-workspace.md) — native doctor/HOD dashboard: hardcoded HEAD uuid gates, RLT-temp→modality_frequency, 'Standardized Assessment'.clientAge JSON gotcha, counselling/findings invisible to admin RLS, write paths untested (no doctor password)
