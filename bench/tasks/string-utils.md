# Bench task (small), `slugify`

> Fixed, fully-specified benchmark task. **Do not edit between runs**, both arms read the same
> bytes (a `sha256sum` pre-flight in `run.sh` guards against drift). The matching machine-readable
> task object lives in `bench/tasks.json` (the single source of truth handed to both arms); this
> file is the human-readable spec it mirrors.

## id

`slugify`

## Spec

Implement `slugify(input: string): string`, **default-exported** from `src/slugify.js`, with
tests in `test/slugify.test.js` using `node:test` (`import { test } from 'node:test'`) and
`node:assert/strict`.

## Acceptance criteria (each is one test case)

1. **Lowercases:** `"Hello"` → `"hello"`
2. **Spaces (incl. runs) → single hyphens:** `"a  b   c"` → `"a-b-c"`
3. **Strips non-alphanumeric except hyphen:** `"Café!! #1"` → `"caf-1"`
   (drop accents/punctuation; a non-alnum char becomes a hyphen boundary, not retained)
4. **Trims leading/trailing hyphens:** `"  -hi-  "` → `"hi"`
5. **Collapses multiple hyphens:** `"a---b"` → `"a-b"`
6. **Empty / all-punctuation input → `""`:** `""` → `""`, `"!!!"` → `""`

## TDD

Write `test/slugify.test.js` **first** with the 6 cases above; watch them fail (module missing),
that is RED. Then implement to GREEN.

## Constraints (so the quality reviewer has teeth)

- No external dependencies.
- Single responsibility: the slug function only, no CLI, no extra exports beyond the default.

## Verify

```
node --test
```

Exits `0` with the 6 `slugify` tests passing.
