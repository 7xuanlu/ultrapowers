# Deterministic gating & escalation

All gates are **binary + bounded**, never confidence-scored.

- **Gate A (verify/fix-loop):** fires on deterministic signals, test exit code,
  re-witness RED, blocking-severity findings, bounded at `MAX_FIX = 3` rounds; anti-thrash
  guard stops if blocking findings don't shrink for 2 consecutive rounds.
- **Gate B (replan/critic):** critic returns binary `{clean: true|false}`; loops until clean
  or `maxRounds`/budget hit. Opt-in via `loopUntilClean:true` (**goal mode only**).
- **Gate C (escalate to human):** named terminal conditions (implementer blocked,
  no-progress, max-fix exhausted, review unavailable, integration veto, budget ceiling,
  degraded) set `needsHuman:true` for the command's critical-review gate; graduated first
  (e.g. try decompose before escalating).
