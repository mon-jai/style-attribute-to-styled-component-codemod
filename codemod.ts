import type { API, FileInfo, JSXAttribute, Node, Options, Property } from "jscodeshift"
import type { CSSProperties } from "react"

type StyledComponentToCreate = { componentName: string; tagName: string; css: CSSProperties }

function isEqualCSSObject(object_1: CSSProperties, object_2: CSSProperties): boolean {
  if (Object.keys(object_1).length !== Object.keys(object_2).length) return false

  for (const key in object_1) {
    if (!(key in object_2)) return false
    if (object_1[key as keyof typeof object_1] !== object_2[key as keyof typeof object_2]) return false
  }

  return true
}

function lastIndexOfRegex(string: string, regex: RegExp, lastIndex = -1): number {
  // https://stackoverflow.com/a/273810
  const index = string.search(regex)
  return index === -1 ? lastIndex : lastIndexOfRegex(string.slice(index + 1), regex, index)
}

export default function transform(file: FileInfo, api: API, _options: Options): string | void {
  const { jscodeshift } = api
  const root = jscodeshift(file.source)

  let hasModifications = false
  const styledComponentsToCreate: StyledComponentToCreate[] = []

  root.find(jscodeshift.JSXElement).forEach(jsxElement => {
    const { openingElement, closingElement } = jsxElement.__childCache as any
    const attributes = openingElement.node.attributes

    const tagName = openingElement.value.name.name
    if (tagName === undefined) return
    if (tagName.charAt(0).match(/[A-Z]/)) return

    const styleAttributeIndex = attributes.findIndex((attribute: JSXAttribute) => attribute?.name?.name === "style")
    if (styleAttributeIndex === -1) return

    const styleAttribute = attributes[styleAttributeIndex]
    if (styleAttribute.value.expression?.type !== "ObjectExpression") return

    const cssObject: CSSProperties = {}
    for (let i = 0; i < styleAttribute.value.expression.properties.length; i++) {
      const property: Node = styleAttribute.value.expression.properties[i]
      if (property.type !== "Property") continue

      const { key, value } = property as Property
      // Identifier key: { color: red }
      // Literal key: { "color": red }
      if ((key.type !== "Identifier" && key.type !== "Literal") || value.type !== "Literal") {
        // Style attribute with JavaScript code needed too be rewritten manually.
        continue
      }

      const cssProperty = (key.type === "Identifier" ? key.name : (key.value as string)).replaceAll(
        /[A-Z]/g,
        (match: string) => `-${match.toLowerCase()}`
      )
      const cssValue = value.value as string

      // error TS2590: Expression produces a union type that is too complex to represent.
      // @ts-expect-error
      cssObject[cssProperty] = cssValue
      delete styleAttribute.value.expression.properties[i]
    }
    if (Object.keys(cssObject).length === 0) return

    hasModifications = true

    let componentName: string
    const componentWithSameCSS = styledComponentsToCreate.find(({ css }) => isEqualCSSObject(css, cssObject))
    if (componentWithSameCSS !== undefined) {
      componentName = componentWithSameCSS.componentName
    } else {
      for (let i = 0; ; i++) {
        componentName = `${tagName.charAt(0).toUpperCase()}${tagName.slice(1)}${i}`
        if (!styledComponentsToCreate.find(componentToCreate => componentToCreate.componentName === componentName)) {
          break
        }
      }
      styledComponentsToCreate.push({ componentName, tagName, css: cssObject })
    }

    // Delete styleAttribute if there is no property left
    if (styleAttribute.value.expression.properties.every((property: Property | undefined) => property === undefined)) {
      delete openingElement.node.attributes[styleAttributeIndex]
    }

    // Replace element with a styled component
    openingElement.value.name.name = componentName
    if (closingElement.value !== null) closingElement.value.name.name = componentName
  })

  if (!hasModifications) return

  const source = root.toSource()

  const lastImportStart = lastIndexOfRegex(source, /^import +[A-Za-z0-9\{\} ]+ from/m)
  const lastImportEnd = lastImportStart === -1 ? 0 : lastImportStart + source.slice(lastImportStart).indexOf("\n")

  return (
    source.slice(0, lastImportEnd) +
    [
      // Add import statement if styled isn't imported
      source.search(/import.*styled.*from\s+['"]styled-components['"]/m) === -1
        ? 'import styled from "styled-components"\n'
        : "",
      ...styledComponentsToCreate.map(({ componentName, tagName, css }) => {
        const cssString = Object.entries(css)
          .map(([property, value]) => `  ${property}: ${value};`)
          .join("\n")
        return `const ${componentName} = styled.${tagName}\`\n${cssString}\n\`\n`
      })
    ].join("\n") +
    source.slice(lastImportEnd)
  )
}
