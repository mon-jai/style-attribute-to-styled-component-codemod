#!/usr/bin/env node
import { execFileSync } from "child_process"

function resolve(path) {
  return import.meta.resolve(path).replace(/^file:\/\/\//, "")
}

execFileSync(
  "node",
  [resolve("../node_modules/jscodeshift/bin/jscodeshift.js"), "-t", resolve("../codemod.ts"), ...process.argv.slice(2)],
  { stdio: "inherit" }
)
