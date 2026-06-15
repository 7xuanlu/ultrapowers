# Bench task (medium) — `parseDuration`

> Fixed, fully-specified benchmark task. **Do not edit between runs** — both arms read the same
> bytes (a `sha256sum` pre-flight in `run.sh` guards against drift). The matching machine-readable
> task object lives in `bench/tasks.json` (the single source of truth handed to both arms); this
> file is the human-readable spec it mirrors.

## id

`parseDuration`

## Spec

Implement `parseDuration(input: string): number`, **default-exported** from
`src/parseDuration.js`, returning the total **milliseconds** for a human duration string. Tests in
`test/parseDuration.test.js` (`node:test` + `node:assert/strict`).

**Grammar:** one or more whitespace-tolerant `<number><unit>` segments, summed.
Units (case-insensitive): `ms`, `s`, `m`, `h`, `d` → `1`, `1000`, `60_000`, `3_600_000`,
`86_400_000`. Numbers may be integers or decimals (`"1.5h"`). Segments may be space-separated
(`"1h 30m"`) or concatenated (`"1h30m"`). A bare number with no unit is **INVALID**.

## Acceptance criteria (each ≥1 test case)

1. **Single segment:** `"500ms"`→`500`, `"2s"`→`2000`, `"1m"`→`60000`, `"1h"`→`3600000`,
   `"1d"`→`86400000`
2. **Decimal:** `"1.5h"`→`5400000`, `"0.5s"`→`500`
3. **Multi-segment concatenated:** `"1h30m"`→`5400000`
4. **Multi-segment spaced, mixed case:** `"1H 30M 15s"`→`5415000`
5. **Leading/trailing whitespace tolerated:** `"  2m  "`→`120000`
6. **INVALID → throw a `TypeError`** with a message containing the offending input:
   `""`, `"abc"`, `"10"` (no unit), `"5x"` (bad unit), `"1.2.3s"` (bad number) all throw.

## TDD

Write the test file **first** covering all 6 groups incl. the throw cases (use `assert.throws`
with the `TypeError` + message-substring check); watch RED; implement to GREEN.

## Constraints (so the quality reviewer has teeth)

- No external dependencies. No regex catastrophic-backtracking on adversarial input.
- Single responsibility: parser only — no CLI, no formatting helper, no exports beyond the default.

## Verify

```
node --test
```

Exits `0` with all `parseDuration` tests passing.
