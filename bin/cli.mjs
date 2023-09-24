#!/usr/bin/env node
import { spawn } from "child_process"
import { readFile } from "fs/promises"

const PACKAGE_NAME = JSON.parse(await readFile(resolve("../package.json"))).name

function resolve(path) {
  return import.meta.resolve(path).replace(/^file:\/\/\//, "")
}

function rebrand(data) {
  return data.toString().replaceAll("jscodeshift", PACKAGE_NAME).trim()
}

const jscodeshift = spawn(
  "node",
  [resolve("../node_modules/jscodeshift/bin/jscodeshift.js"), "-t", resolve("../codemod.ts"), ...process.argv.slice(2)],
  { env: { ...process.env, FORCE_COLOR: true } }
)

process.stdin.pipe(jscodeshift.stdin)

jscodeshift.stdout.on("data", data => console.log(rebrand(data)))
jscodeshift.stderr.on("data", data => console.error(rebrand(data)))
jscodeshift.on("exit", process.exit)
