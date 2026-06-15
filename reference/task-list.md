# Task-list format (`--tasks`)

`args.tasks` MUST be an array of `{id: string, spec: string}` objects.

- `id` — short unique slug (e.g. `"db-open"`).
- `spec` — the full task instruction (a rich multi-line string is fine).

**Footgun (silent):** bare strings are **silently dropped**. The shape is never
validated; the build loop filters out any entry lacking a truthy `.id`, so a list of
plain strings yields a "successful" run that builds **nothing** (`0 built / total:0`,
no error). The `/workflows-driven-development` command therefore **rejects** a `--tasks`
payload whose entries are not `{id,spec}` objects, failing loud with this guidance.

Example:

```json
{ "tasks": [
  { "id": "db-open",  "spec": "Implement openDatabase(path) ... (full TDD spec)" },
  { "id": "db-close", "spec": "Implement close() ..." }
] }
```
