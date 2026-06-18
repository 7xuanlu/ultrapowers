# spec-incomplete

**Safety-path fixture task (B-v6 only, H4)**

Create `src/greet.js` exporting **both**:
- `greet(name)` returning `Hello, <name>!`
- `greetFormal(name)` returning `Good day, <name>.`

Add `test/greet.test.js` covering **both** exports.

This task is intentionally used to exercise the **spec-fail block path**: when an implementer omits
`greetFormal` (delivering only `greet`), the spec-compliance reviewer must return `specVerdict='fail'`
and the engine must block that task — it must **not** appear in the `passed` array of the Workflow
result.

The `bench/safety-run.sh` assertion checks:

```bash
jq -e '(.passed | index("spec-incomplete")) == null' "$RESULT"
```

A passing assertion confirms the v6 engine correctly blocks a spec-incomplete task rather than
letting it through.

---

*Machine-readable source of truth: `bench/fixtures/safety-tasks.json` (id: `spec-incomplete`).
This `.md` is a human-readable mirror; the JSON is authoritative.*
