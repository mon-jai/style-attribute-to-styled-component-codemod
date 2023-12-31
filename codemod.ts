import type {
  API,
  ASTPath,
  Collection,
  FileInfo,
  JSCodeshift,
  JSXAttribute,
  Node,
  ObjectExpression,
  Options,
  Property,
  VariableDeclaration
} from "jscodeshift"

type CSSDeclarations = { [key: string]: string | number }
type StyledComponent = {
  name: string
  tagName: string
  css: CSSDeclarations
  declaration?: ASTPath<VariableDeclaration>
}
type StyledComponentInheritingOtherComponent = StyledComponent & { extendedFrom: StyledComponent }

let SIMILAR_COMPONENTS_MINIMUM_COMMON_DECLARATIONS: number

// Utility functions

// https://stackoverflow.com/a/68821383/
const isNumber = (value: string) => !isNaN(parseFloat(value))

const toComponentName = (tagName: string) => `${tagName.charAt(0).toUpperCase()}${tagName.slice(1)}`

function stringToCssObject(cssString: string): CSSDeclarations {
  return Object.fromEntries(
    cssString
      .split(";")
      .map(declaration => declaration.trim())
      .filter(declaration => declaration.includes(":"))
      .map(declaration => {
        const [property, value] = declaration.split(":").map(value => value.trim()) as [string, string]
        return [property, isNumber(value) ? parseFloat(value) : value]
      })
  )
}

function isEqualCssObject(object_1: CSSDeclarations, object_2: CSSDeclarations): boolean {
  if (Object.keys(object_1).length !== Object.keys(object_2).length) return false

  for (const key in object_1) {
    if (!(key in object_2)) return false
    if (object_1[key as keyof typeof object_1] !== object_2[key as keyof typeof object_2]) return false
  }

  return true
}

function findSimilarComponent(
  component: Omit<StyledComponent, "name">,
  existingComponents: (StyledComponent | StyledComponentInheritingOtherComponent)[]
) {
  let maximumSameDeclarationCount = 0
  let mostSimilarComponent: StyledComponent | StyledComponentInheritingOtherComponent | undefined = undefined
  let mostSimilarComponentCommonStyle: CSSDeclarations = {}
  let mostSimilarComponentOnlyStyle: CSSDeclarations = {}

  for (const existingComponent of existingComponents) {
    if (component.tagName !== existingComponent.tagName) continue

    let sameKeyCount = 0
    const commonStyle: CSSDeclarations = {}
    const similarComponentOnlyStyle: CSSDeclarations = {}

    const existingComponentCss = {
      ...existingComponent.css,
      ...("extendedFrom" in existingComponent ? existingComponent.extendedFrom.css : {})
    }
    for (const property in existingComponentCss) {
      const value = existingComponentCss[property as keyof typeof existingComponentCss]!
      if (property in component.css && component.css[property] === value) {
        sameKeyCount++
        commonStyle[property] = value
      } else {
        similarComponentOnlyStyle[property] = value
      }
    }

    const existingComponentNeedsToBeRewritten = Object.keys(similarComponentOnlyStyle).length > 0
    const isExistingComponentBeingNamed = !new RegExp(`^${toComponentName(existingComponent.tagName)}\\d+$`).test(
      existingComponent.name
    )
    const isExistingComponentBeingInherited =
      existingComponents.find(
        component => "extendedFrom" in component && component.extendedFrom === existingComponent
      ) !== undefined
    // Avoid rewriting components that are either named by the user or already being inherited
    if (existingComponentNeedsToBeRewritten && (isExistingComponentBeingNamed || isExistingComponentBeingInherited)) {
      continue
    }

    if (sameKeyCount >= SIMILAR_COMPONENTS_MINIMUM_COMMON_DECLARATIONS && sameKeyCount > maximumSameDeclarationCount) {
      maximumSameDeclarationCount = sameKeyCount
      mostSimilarComponent = existingComponent
      mostSimilarComponentCommonStyle = commonStyle
      mostSimilarComponentOnlyStyle = similarComponentOnlyStyle
    }
  }

  return {
    similarComponent: mostSimilarComponent,
    commonStyle: mostSimilarComponentCommonStyle,
    currentComponentOnlyStyle: Object.fromEntries(
      Object.entries(component.css).filter(([property]) => !(property in mostSimilarComponentCommonStyle))
    ) as CSSDeclarations,
    similarComponentOnlyStyle: mostSimilarComponentOnlyStyle
  }
}

function generateNewComponentName(tagName: string, existingComponents: { name: string }[]) {
  for (let i = 0; ; i++) {
    const name = `${toComponentName(tagName)}${i}`
    if (existingComponents.find(component => component.name === name)) continue
    return name
  }
}

// Functions called by `transform`

function findExistingStyledComponents(root: Collection<any>, jscodeshift: JSCodeshift) {
  const existingStyledComponents: ((StyledComponent | StyledComponentInheritingOtherComponent) & {
    declaration: Required<StyledComponent["declaration"]>
  })[] = []

  root.find(jscodeshift.VariableDeclaration).forEach(variableDeclaration => {
    const variableDeclarator = variableDeclaration.node.declarations[0]
    if (variableDeclarator?.type !== "VariableDeclarator") return

    if (variableDeclarator.id.type !== "Identifier") return
    const { name } = variableDeclarator.id

    if (variableDeclarator.init?.type !== "TaggedTemplateExpression") return
    if (variableDeclarator.init.quasi.quasis[0] === undefined) return
    const cssString = variableDeclarator.init.quasi.quasis[0].value.raw

    if (variableDeclarator.init.tag.type === "CallExpression") {
      if (variableDeclarator.init.tag.callee.type !== "Identifier") return
      if (variableDeclarator.init.tag.callee.name !== "styled") return

      if (variableDeclarator.init.tag.arguments[0]?.type !== "Identifier") return
      const baseComponentName = variableDeclarator.init.tag.arguments[0].name

      const baseComponent = root
        .find(jscodeshift.VariableDeclaration, variableDeclaration => {
          const variableDeclarator = variableDeclaration.declarations[0]
          if (variableDeclarator?.type !== "VariableDeclarator") return false
          if (variableDeclarator.id.type !== "Identifier") return false
          return variableDeclarator.id.name === baseComponentName
        })
        .nodes()[0]

      if (baseComponent?.declarations[0]?.type !== "VariableDeclarator") return
      if (baseComponent.declarations[0].init?.type !== "TaggedTemplateExpression") return

      if (baseComponent.declarations[0].init.tag.type !== "MemberExpression") return
      if (baseComponent.declarations[0].init.tag.property.type !== "Identifier") return
      const tagName = baseComponent.declarations[0].init.tag.property.name

      if (baseComponent.declarations[0].init.quasi.quasis[0] === undefined) return
      const baseComponentCssString = baseComponent.declarations[0].init.quasi.quasis[0].value.raw

      existingStyledComponents.push({
        name,
        tagName,
        css: stringToCssObject(cssString),
        extendedFrom: {
          name: baseComponentName,
          tagName,
          css: stringToCssObject(baseComponentCssString)
        },
        declaration: variableDeclaration
      })
    } else if (variableDeclarator.init.tag.type === "MemberExpression") {
      if (variableDeclarator.init.tag.object.type !== "Identifier") return
      if (variableDeclarator.init.tag.object.name !== "styled") return

      if (variableDeclarator.init.tag.property.type !== "Identifier") return
      const tagName = variableDeclarator.init.tag.property.name

      existingStyledComponents.push({
        name,
        tagName,
        css: stringToCssObject(cssString),
        declaration: variableDeclaration
      })
    } else {
      throw "Not implemented"
    }
  })

  return existingStyledComponents
}

function extractCssObject(styleAttribute: { value: { expression: ObjectExpression } }) {
  const cssObject: CSSDeclarations = {}

  for (let i = 0; i < styleAttribute.value.expression.properties.length; i++) {
    const property: Node = styleAttribute.value.expression.properties[i]!
    if (property.type !== "Property") continue

    const { key, value } = property as Property
    // `Identifier` key: { color: red }, `Literal` key: { "color": red }
    // Dynamically computed CSS properties and values needed too be rewritten manually.
    if ((key.type !== "Identifier" && key.type !== "Literal") || value.type !== "Literal") continue

    delete styleAttribute.value.expression.properties[i]
    if (value.value === "") continue

    const cssProperty = (key.type === "Identifier" ? key.name : (key.value as string)).replaceAll(
      /[A-Z]/g,
      (match: string) => `-${match.toLowerCase()}`
    )
    const cssValue = value.value as CSSDeclarations[keyof CSSDeclarations]
    cssObject[cssProperty] = cssValue
  }

  return cssObject
}

function categorizeComponent(
  tagName: string,
  cssObject: CSSDeclarations,
  existingStyledComponents: (StyledComponent | StyledComponentInheritingOtherComponent)[],
  styledComponentsFromScratch: StyledComponent[],
  styledComponentsInheritingOtherComponents: StyledComponentInheritingOtherComponent[],
  jscodeshift: JSCodeshift
) {
  const sameComponent =
    styledComponentsFromScratch.find(({ css }) => isEqualCssObject(cssObject, css)) ??
    styledComponentsInheritingOtherComponents.find(({ css, extendedFrom }) =>
      isEqualCssObject(cssObject, { ...extendedFrom.css, ...css })
    ) ??
    existingStyledComponents.find(component =>
      isEqualCssObject(cssObject, {
        ...("extendedFrom" in component ? component.extendedFrom.css : {}),
        ...component.css
      })
    )
  if (sameComponent !== undefined) return sameComponent.name

  const allStyledComponents = [
    ...existingStyledComponents,
    ...styledComponentsFromScratch,
    ...styledComponentsInheritingOtherComponents
  ]
  const { similarComponent, commonStyle, currentComponentOnlyStyle, similarComponentOnlyStyle } = findSimilarComponent(
    { tagName, css: cssObject },
    allStyledComponents
  )

  if (similarComponent === undefined) {
    // The component is unique
    // Input = { CurrentComponent: { a, b, c } }
    // Output = { CurrentComponent: { a, b, c } }
    const currentComponent = { name: generateNewComponentName(tagName, allStyledComponents), tagName, css: cssObject }
    styledComponentsFromScratch.push(currentComponent)
    return currentComponent.name
  }

  if (Object.keys(similarComponentOnlyStyle).length === 0) {
    // The current component's CSS is a superset of `similarComponent`'s CSS
    // Input = { SimilarComponent: { a, b }, CurrentComponent: { a, b, c } }
    // Output = { SimilarComponent: { a, b }, CurrentComponent: SimilarComponent & { c } }
    const currentComponent = {
      name: generateNewComponentName(tagName, allStyledComponents),
      tagName,
      extendedFrom: similarComponent,
      css: currentComponentOnlyStyle
    }
    styledComponentsInheritingOtherComponents.push(currentComponent)
    return currentComponent.name
  }

  const baseComponent = { name: generateNewComponentName(tagName, allStyledComponents), tagName, css: commonStyle }
  const newSimilarComponent = { ...similarComponent, extendedFrom: baseComponent, css: similarComponentOnlyStyle }
  const similarComponentIndex = styledComponentsFromScratch.findIndex(({ name }) => name === similarComponent.name)

  if ("declaration" in similarComponent) jscodeshift(similarComponent.declaration).remove()
  // Remove `similarComponent` from `styledComponentsFromScratch`
  if (similarComponentIndex !== -1) styledComponentsFromScratch.splice(similarComponentIndex, 1)

  allStyledComponents.push(baseComponent)
  styledComponentsFromScratch.push(baseComponent)
  styledComponentsInheritingOtherComponents.push(newSimilarComponent)

  // Input = { SimilarComponent: { a, b, c }, CurrentComponent: { a, b } }
  // Output = { Base: { a, b }, SimilarComponent: Base & { c }, CurrentComponent: Base }
  if (Object.keys(currentComponentOnlyStyle).length === 0) return baseComponent.name

  // Input = { SimilarComponent: { a, b, c }, CurrentComponent: { a, b, d } }
  // Output = { Base: { a, b }, SimilarComponent: Base & { c }, CurrentComponent: Base & { d } }
  const currentComponent = {
    name: generateNewComponentName(tagName, allStyledComponents),
    tagName,
    extendedFrom: baseComponent,
    css: currentComponentOnlyStyle
  }
  styledComponentsInheritingOtherComponents.push(currentComponent)
  return currentComponent.name
}

function lastIndexOfRegex(string: string, regex: RegExp, lastIndex = -1): number {
  // https://stackoverflow.com/a/273810
  const index = string.search(regex)
  return index === -1 ? lastIndex : lastIndexOfRegex(string.slice(index + 1), regex, index + 1 + lastIndex)
}

function cssObjectToString(object: CSSDeclarations) {
  return Object.entries(object)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join("\n")
}

export default function transform(file: FileInfo, api: API, options: Options): string | void {
  const { jscodeshift } = api
  const root = jscodeshift(file.source)

  SIMILAR_COMPONENTS_MINIMUM_COMMON_DECLARATIONS = options["similar-components-minimum-common-declarations"] ?? 5

  let hasModifications = false
  const existingStyledComponents = findExistingStyledComponents(root, jscodeshift)
  const styledComponentsFromScratch: StyledComponent[] = []
  const styledComponentsInheritingOtherComponents: StyledComponentInheritingOtherComponent[] = []

  root.find(jscodeshift.JSXElement).forEach(jsxElement => {
    const { openingElement, closingElement } = jsxElement.node
    const attributes = openingElement.attributes
    if (attributes === undefined) return

    const tagName = "name" in openingElement.name ? (openingElement.name.name as string) : undefined
    if (tagName === undefined) return
    if (tagName.charAt(0).match(/[A-Z]/)) return

    const styleAttributeIndex = attributes.findIndex(
      attribute => "name" in attribute && attribute.name.name === "style"
    )
    if (styleAttributeIndex === -1) return

    const styleAttribute = attributes[styleAttributeIndex] as JSXAttribute
    if (styleAttribute.value?.type !== "JSXExpressionContainer") return
    if (styleAttribute.value.expression.type !== "ObjectExpression") return

    const cssObject = extractCssObject(styleAttribute as { value: { expression: ObjectExpression } })
    if (Object.keys(cssObject).length === 0) return

    hasModifications = true

    // Delete styleAttribute if there is no property left
    if (styleAttribute.value.expression.properties.every(property => property === undefined)) {
      delete attributes[styleAttributeIndex]
    }

    const componentName = categorizeComponent(
      tagName,
      cssObject,
      existingStyledComponents,
      styledComponentsFromScratch,
      styledComponentsInheritingOtherComponents,
      jscodeshift
    )

    // Replace element with a styled component
    if (!("name" in openingElement.name)) return
    openingElement.name.name = componentName
    if (closingElement?.name.type !== "JSXIdentifier") return
    closingElement.name.name = componentName
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
    styledComponentsFromScratch
      .map(({ name, tagName, css }) => `const ${name} = styled.${tagName}\`\n${cssObjectToString(css)}\n\`\n`)
      .join("\n") +
    source.slice(lastImportEnd, exportDefaultStart) +
    styledComponentsInheritingOtherComponents
      .map(
        ({ name, extendedFrom, css }) =>
          `const ${name} = styled(${extendedFrom.name})\`\n${cssObjectToString(css)}\n\`\n`
      )
      .join("\n") +
    source.slice(exportDefaultStart)
  )
}
