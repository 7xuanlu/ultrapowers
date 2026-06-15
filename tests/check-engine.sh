#!/usr/bin/env bash
# Syntax-check the Workflow engine the way the runtime loads it: strip the `export`
# keyword(s) and compile the body as an async IIFE (parse-only via vm.Script). Stock
# `node --check` rejects the engine's top-level `return`/`await`; this does not.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# NOTE: the strip assumes `export <decl>` form (the engine's only export). `export default` / `export { x }` would need handling.
node --input-type=commonjs -e '
  const fs = require("fs");
  const s = fs.readFileSync(process.argv[1], "utf8").replace(/^export\s+/gm, "");
  new (require("vm").Script)("(async()=>{" + s + "\n})()");
  console.log("engine syntax ok");
' "$ROOT/workflow/ultrapowers-development.js"
