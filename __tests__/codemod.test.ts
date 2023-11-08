import { readFile } from "fs/promises"

import { expect, it } from "@jest/globals"
import jscodeshiftCore, { API } from "jscodeshift"

import transform from "../codemod.ts"

async function transformFile(filename: string) {
  const path = `__tests__/fixtures/${filename}`
  const source = await readFile(path, "utf-8")
  const jscodeshift = jscodeshiftCore.withParser("babel")

  return transform({ path, source }, { jscodeshift } as API, {})
}

it("should parse component that inherits another component", async () => {
  const transformedSource = await transformFile("inheritance.jsx")
  return expect(transformedSource).toMatchSnapshot()
})

it("should update unnamed components if appropriate", async () => {
  const transformedSource = await transformFile("unnamed-component.jsx")
  return expect(transformedSource).toMatchSnapshot()
})

it("should not overwrite user-named components", async () => {
  const transformedSource = await transformFile("user-named-component.jsx")
  return expect(transformedSource).toMatchSnapshot()
})
