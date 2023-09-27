import type { API, FileInfo, JSXAttribute, Node, Options, Property, VariableDeclarator } from "jscodeshift"
import type { CSSProperties } from "react"

type StyledComponent = { name: string; css: CSSProperties }
type StyledComponentFromExistingComponent = StyledComponent & { extendedFrom: string }
type StyledComponentFromScratch = StyledComponent & { tagName: string }

const SIMILAR_CSS_OBJECT_KEY_COUNT = 5

function isEqualCSSObject(object_1: CSSProperties, object_2: CSSProperties): boolean {
  if (Object.keys(object_1).length !== Object.keys(object_2).length) return false

  for (const key in object_1) {
    if (!(key in object_2)) return false
    if (object_1[key as keyof typeof object_1] !== object_2[key as keyof typeof object_2]) return false
  }

  return true
}

function isSimilarCSSObject(object_1: CSSProperties, object_2: CSSProperties): boolean {
  let sameKeyCount = 0
  for (const key in object_1) {
    if (!(key in object_2)) continue
    if (object_1[key as keyof typeof object_1] === object_2[key as keyof typeof object_2]) sameKeyCount++
  }

  return sameKeyCount >= SIMILAR_CSS_OBJECT_KEY_COUNT
}

function lastIndexOfRegex(string: string, regex: RegExp, lastIndex = -1): number {
  // https://stackoverflow.com/a/273810
  const index = string.search(regex)
  return index === -1 ? lastIndex : lastIndexOfRegex(string.slice(index + 1), regex, index + 1 + lastIndex)
}

function cssObjectToString(object: CSSProperties) {
  return Object.entries(object)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join("\n")
}

export default function transform(file: FileInfo, api: API, _options: Options): string | void {
  const { jscodeshift } = api
  const root = jscodeshift(file.source)

  let hasModifications = false
  const styledComponentsFromExistingComponent: StyledComponentFromExistingComponent[] = []
  const styledComponentsToCreate: StyledComponentFromScratch[] = []

  const existingStyledComponents: StyledComponent[] = []
  root.find(jscodeshift.VariableDeclaration).forEach(variableDeclaration => {
    const variableDeclarator = variableDeclaration.node.declarations.find(
      (declaration): declaration is VariableDeclarator => declaration.type === "VariableDeclarator"
    )
    if (variableDeclarator === undefined) return

    if (
      variableDeclarator.init?.type !== "TaggedTemplateExpression" ||
      variableDeclarator.init.tag.type !== "MemberExpression" ||
      variableDeclarator.init.tag.object.type !== "Identifier" ||
      variableDeclarator.init.tag.object.name !== "styled"
    ) {
      return
    }

    const id = variableDeclarator.id
    if (id.type !== "Identifier") return

    const { name } = id
    existingStyledComponents.push({
      name,
      css: Object.fromEntries(
        variableDeclarator.init.quasi.quasis[0]!.value.raw.split(";").map(
          declaration => declaration.split(":") as [string, string]
        )
      ) as CSSProperties
    })
  })
  const existingStyledComponentNames = existingStyledComponents.map(({ name }) => name)

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

      delete styleAttribute.value.expression.properties[i]

      if (value.value === "") continue

      const cssProperty = (key.type === "Identifier" ? key.name : (key.value as string)).replaceAll(
        /[A-Z]/g,
        (match: string) => `-${match.toLowerCase()}`
      )
      const cssValue = value.value as CSSProperties[keyof CSSProperties]

      // error TS2590: Expression produces a union type that is too complex to represent.
      // @ts-expect-error
      cssObject[cssProperty] = cssValue
    }
    if (Object.keys(cssObject).length === 0) return

    hasModifications = true

    let name: string
    const componentWithSameCSS = styledComponentsToCreate.find(({ css }) => isEqualCSSObject(css, cssObject))
    if (componentWithSameCSS !== undefined) {
      name = componentWithSameCSS.name
    } else {
      for (let i = 0; ; i++) {
        name = `${tagName.charAt(0).toUpperCase()}${tagName.slice(1)}${i}`
        if (
          !styledComponentsToCreate.find(componentToCreate => componentToCreate.name === name) &&
          !existingStyledComponentNames.includes(name)
        ) {
          break
        }
      }

      let similarComponent: StyledComponent | undefined
      for (const component of [...existingStyledComponents, ...styledComponentsToCreate]) {
        if (isSimilarCSSObject(cssObject, component.css)) {
          similarComponent = component
          break
        }
      }

      if (similarComponent !== undefined) {
        styledComponentsFromExistingComponent.push({ name, extendedFrom: similarComponent.name, css: cssObject })
      } else {
        styledComponentsToCreate.push({ name, tagName, css: cssObject })
      }
    }

    // Delete styleAttribute if there is no property left
    if (styleAttribute.value.expression.properties.every((property: Property | undefined) => property === undefined)) {
      delete openingElement.node.attributes[styleAttributeIndex]
    }

    // Replace element with a styled component
    openingElement.value.name.name = name
    if (closingElement.value !== null) closingElement.value.name.name = name
  })

  if (!hasModifications) return

  const source = root.toSource()

  const lastImportStart = lastIndexOfRegex(source, /^import\s[A-Za-z0-9\{\},\s]+ from/m)
  const lastImportEnd = lastImportStart === -1 ? 0 : lastImportStart + source.slice(lastImportStart).indexOf("\n")

  const exportDefaultStart = lastIndexOfRegex(source, /export default/) - 1

  return (
    source.slice(0, lastImportEnd) +
    // Add import statement if styled isn't imported
    (source.search(/import.*styled.*from\s+['"]styled-components['"]/m) === -1
      ? 'import styled from "styled-components"\n'
      : "\n") +
    styledComponentsToCreate
      .map(({ name, tagName, css }) => `const ${name} = styled.${tagName}\`\n${cssObjectToString(css)}\n\`\n`)
      .join("\n") +
    source.slice(lastImportEnd, exportDefaultStart) +
    styledComponentsFromExistingComponent
      .map(
        ({ name, extendedFrom, css }) => `const ${name} = styled(${extendedFrom})\`\n${cssObjectToString(css)}\n\`\n`
      )
      .join("\n") +
    source.slice(exportDefaultStart)
  )
}
