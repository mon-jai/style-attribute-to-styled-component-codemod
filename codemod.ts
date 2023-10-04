import type {
  API,
  Collection,
  FileInfo,
  JSCodeshift,
  JSXAttribute,
  Node,
  ObjectExpression,
  Options,
  Property,
  VariableDeclarator
} from "jscodeshift"

type CSSDeclarations = { [key: string]: string | number }
type StyledComponent = { name: string; tagName: string; css: CSSDeclarations }
type StyledComponentExtendedFromOtherComponent = StyledComponent & { extendedFrom: StyledComponent }

const SIMILAR_CSS_OBJECT_KEY_COUNT = 5

function isEqualCSSObject(object_1: CSSDeclarations, object_2: CSSDeclarations): boolean {
  if (Object.keys(object_1).length !== Object.keys(object_2).length) return false

  for (const key in object_1) {
    if (!(key in object_2)) return false
    if (object_1[key as keyof typeof object_1] !== object_2[key as keyof typeof object_2]) return false
  }

  return true
}

function extractExistingStyledComponents(root: Collection<any>, jscodeshift: JSCodeshift) {
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
      tagName:
        variableDeclarator.init.tag.property.type === "Identifier"
          ? variableDeclarator.init.tag.property.name
          : "ExtendedComponent",
      css: Object.fromEntries(
        variableDeclarator.init.quasi.quasis[0]!.value.raw.split(";")
          .map(declaration => declaration.trim())
          .filter(declaration => declaration.includes(":"))
          .map(declaration => declaration.split(":").map(value => value.trim()))
      )
    })
  })

  return existingStyledComponents
}

function extractCSSObject(styleAttribute: { value: { expression: ObjectExpression } }) {
  const cssObject: CSSDeclarations = {}

  for (let i = 0; i < styleAttribute.value.expression.properties.length; i++) {
    const property: Node = styleAttribute.value.expression.properties[i]!
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
    const cssValue = value.value as CSSDeclarations[keyof CSSDeclarations]
    cssObject[cssProperty] = cssValue
  }

  return cssObject
}

function findSimilarComponent(
  component: Omit<StyledComponent, "name">,
  existingComponents: (StyledComponent | StyledComponentExtendedFromOtherComponent)[]
) {
  let maximumSameDeclarationCount = 0
  let mostSimilarComponent: StyledComponent | undefined = undefined
  let mostSimilarComponentCommonStyle: CSSDeclarations = {}
  let mostSimilarComponentOnlyStyle: CSSDeclarations = {}

  for (const existingComponent of existingComponents) {
    if (component.tagName !== existingComponent.tagName) continue

    let sameKeyCount = 0
    const commonStyle: CSSDeclarations = {}
    const similarComponentOnlyStyle: CSSDeclarations = {}
    const isExistingComponentBeingInherited =
      existingComponents.find(
        component => "extendedFrom" in component && component.extendedFrom === existingComponent
      ) !== undefined

    for (const property in existingComponent.css) {
      const value = existingComponent.css[property as keyof typeof existingComponent.css]!
      if (component.css[property as keyof typeof component.css] === value) {
        sameKeyCount++
        commonStyle[property] = value
      } else {
        similarComponentOnlyStyle[property] = value
      }
    }

    if (
      (Object.keys(similarComponentOnlyStyle).length === 0 || !isExistingComponentBeingInherited) &&
      sameKeyCount >= SIMILAR_CSS_OBJECT_KEY_COUNT &&
      sameKeyCount > maximumSameDeclarationCount
    ) {
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
    const name = `${tagName.charAt(0).toUpperCase()}${tagName.slice(1)}${i}`
    if (existingComponents.find(component => component.name === name)) continue
    return name
  }
}

function categorizeComponent(
  tagName: string,
  cssObject: CSSDeclarations,
  existingStyledComponents: (StyledComponent | StyledComponentExtendedFromOtherComponent)[],
  styledComponentsFromScratch: StyledComponent[],
  styledComponentsFromExistingComponent: StyledComponentExtendedFromOtherComponent[]
) {
  const sameComponent =
    styledComponentsFromScratch.find(({ css }) => isEqualCSSObject(cssObject, css)) ??
    styledComponentsFromExistingComponent.find(({ css, extendedFrom }) =>
      isEqualCSSObject(cssObject, { ...extendedFrom.css, ...css })
    )
  if (sameComponent !== undefined) return sameComponent.name

  const allStyledComponents = [
    ...existingStyledComponents,
    ...styledComponentsFromScratch,
    ...styledComponentsFromExistingComponent
  ]
  const { similarComponent, commonStyle, currentComponentOnlyStyle, similarComponentOnlyStyle } = findSimilarComponent(
    { tagName, css: cssObject },
    allStyledComponents.filter(component => component.tagName !== "ExtendedComponent")
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
    styledComponentsFromExistingComponent.push(currentComponent)
    return currentComponent.name
  }

  const baseComponent = { name: generateNewComponentName(tagName, allStyledComponents), tagName, css: commonStyle }
  const newSimilarComponent = { ...similarComponent, extendedFrom: baseComponent, css: similarComponentOnlyStyle }
  const similarComponentIndex = styledComponentsFromScratch.findIndex(({ name }) => name === similarComponent.name)

  allStyledComponents.push(baseComponent)
  allStyledComponents.push(newSimilarComponent)
  styledComponentsFromScratch.splice(similarComponentIndex, 1) // Remove `similarComponent` from `styledComponentsFromScratch`
  styledComponentsFromScratch.push(baseComponent)
  styledComponentsFromExistingComponent.push(newSimilarComponent)

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
  styledComponentsFromExistingComponent.push(currentComponent)
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

export default function transform(file: FileInfo, api: API, _options: Options): string | void {
  const { jscodeshift } = api
  const root = jscodeshift(file.source)

  let hasModifications = false
  const existingStyledComponents = extractExistingStyledComponents(root, jscodeshift)
  const styledComponentsFromScratch: StyledComponent[] = []
  const styledComponentsFromExistingComponent: StyledComponentExtendedFromOtherComponent[] = []

  root.find(jscodeshift.JSXElement).forEach(jsxElement => {
    const { openingElement, closingElement } = jsxElement.node
    const attributes = openingElement.attributes
    if (attributes === undefined) return

    const tagName = "name" in openingElement.name ? (openingElement.name.name as string) : undefined
    if (tagName === undefined) return
    if (tagName.charAt(0).match(/[A-Z]/)) return

    const styleAttributeIndex = attributes?.findIndex(
      attribute => "name" in attribute && attribute.name?.name === "style"
    )
    if (styleAttributeIndex === -1) return

    const styleAttribute = attributes[styleAttributeIndex] as JSXAttribute
    if (!styleAttribute.value || !("expression" in styleAttribute.value)) return
    if (styleAttribute.value.expression?.type !== "ObjectExpression") return

    const cssObject = extractCSSObject(styleAttribute as { value: { expression: ObjectExpression } })
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
      styledComponentsFromExistingComponent
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
    styledComponentsFromExistingComponent
      .map(
        ({ name, extendedFrom, css }) =>
          `const ${name} = styled(${extendedFrom.name})\`\n${cssObjectToString(css)}\n\`\n`
      )
      .join("\n") +
    source.slice(exportDefaultStart)
  )
}
