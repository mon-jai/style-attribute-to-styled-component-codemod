import { readFile } from "fs/promises"

import { expect, test } from "@jest/globals"
import jscodeshiftCore, { API } from "jscodeshift"

import transform from "../codemod.ts"

async function transformFile(filename: string) {
  const path = `__tests__/fixtures/${filename}`
  const source = await readFile(path, "utf-8")
  const jscodeshift = jscodeshiftCore.withParser("babel")

  return transform({ path, source }, { jscodeshift } as API, {})
}

test("components inheritance being parsed correctly", async () => {
  const transformedSource = await transformFile("inheritance.jsx")
  return expect(transformedSource).toMatchSnapshot()
})

test("unnamed components should be updated if appropriate", async () => {
  const transformedSource = await transformFile("unnamed-component.jsx")
  return expect(transformedSource).toMatchSnapshot()
})

test("user-named components should not be overwritten", async () => {
  const transformedSource = await transformFile("user-named-component.jsx")
  return expect(transformedSource).toMatchSnapshot()
})
