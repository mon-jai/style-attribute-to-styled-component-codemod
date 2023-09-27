import type { API, FileInfo, JSXAttribute, Node, Options, Property, VariableDeclarator } from "jscodeshift";


type CSSDeclarations = { [key: string]: string | number }

type StyledComponent = { name: string; tagName: string; css: CSSDeclarations }

type StyledComponentFromExistingComponent = StyledComponent & {
  extendedFrom: StyledComponentFromExistingComponent | StyledComponent
}

const SIMILAR_CSS_OBJECT_KEY_COUNT = 5

function isEqualCSSObject(object_1: CSSDeclarations, object_2: CSSDeclarations): boolean {
  if (Object.keys(object_1).length !== Object.keys(object_2).length) return false

  for (const key in object_1) {
    if (!(key in object_2)) return false
    if (object_1[key as keyof typeof object_1] !== object_2[key as keyof typeof object_2]) return false
  }

  return true
}

function newComponentName(tagName: string, existingComponents: { name: string }[]) {
  let name: string
  for (let i = 0; ; i++) {
    name = `${tagName.charAt(0).toUpperCase()}${tagName.slice(1)}${i}`
    if (existingComponents.find(component => component.name === name)) continue

    // Add a placeholder for the returned name
    existingComponents.push({ name })

    return name
  }
}

function findSimilarComponent(component: Omit<StyledComponent, "name">, existingComponents: StyledComponent[]) {
  let maximumSameDeclarationCount = 0
  let mostSimilarComponent:  StyledComponent | undefined = undefined
  let mostSimilarComponentCommonStyle: CSSDeclarations = {}
  let mostSimilarComponentDifferentStyle: CSSDeclarations = {}

  for (const existingComponent of existingComponents) {
    if (component.tagName !== existingComponent.tagName) continue

    let sameKeyCount = 0
    let commonStyle: CSSDeclarations = {}
    let differentStyle: CSSDeclarations = {}

    if (!Object.keys(existingComponent.css).every(property => property in component.css)) continue

    for (const property in existingComponent.css) {
      const value = existingComponent.css[property as keyof typeof existingComponent.css]!
      if (component.css[property as keyof typeof component.css] === value) {
        sameKeyCount++
        commonStyle[property] = value
      } else {
        differentStyle[property] = value
      }
    }

    if (sameKeyCount >= SIMILAR_CSS_OBJECT_KEY_COUNT && sameKeyCount > maximumSameDeclarationCount) {
      maximumSameDeclarationCount = sameKeyCount
      mostSimilarComponent = existingComponent
      mostSimilarComponentCommonStyle = commonStyle
      mostSimilarComponentDifferentStyle = differentStyle
    }
  }

  return {
    similarComponent: mostSimilarComponent,
    commonStyle: mostSimilarComponentCommonStyle,
    differentStyle: mostSimilarComponentDifferentStyle
  }
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
  let styledComponentsFromScratch: StyledComponent[] = []
  let styledComponentsFromExistingComponent: StyledComponentFromExistingComponent[] = []

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
          .map(declaration => declaration.split(":").map(value => value.trim()) as [string, string])
      ) as CSSDeclarations
    })
  })

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

    const cssObject: CSSDeclarations = {}
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
      const cssValue = value.value as CSSDeclarations[keyof CSSDeclarations]

      cssObject[cssProperty] = cssValue
    }
    if (Object.keys(cssObject).length === 0) return

    hasModifications = true

    let name: string
    const allStyledComponent = [
      ...existingStyledComponents,
      ...styledComponentsFromScratch,
      ...styledComponentsFromExistingComponent
    ]

    const componentWithSameCSS =
      styledComponentsFromScratch.find(({ css }) => isEqualCSSObject(cssObject, css)) ??
      styledComponentsFromExistingComponent.find(({ css, extendedFrom }) =>
        isEqualCSSObject(cssObject, { ...extendedFrom.css, ...css })
      )
    if (componentWithSameCSS !== undefined) {
      name = componentWithSameCSS.name
    } else {
      name = newComponentName(tagName, allStyledComponent)

      let { similarComponent, commonStyle, differentStyle } = findSimilarComponent(
        { tagName, css: cssObject },
        allStyledComponent.filter(
          component => component.tagName !== "ExtendedComponent" && !("extendedFrom" in component)
        )
      )

      if (typeof similarComponent !== "undefined") {
        let baseComponent

        if (Object.keys(differentStyle).length > 0) {
          baseComponent = {
            name: newComponentName(tagName, allStyledComponent),
            tagName,
            css: commonStyle
          }
          styledComponentsFromScratch.push(baseComponent)

          const similarComponentExtended = similarComponent as StyledComponentFromExistingComponent
          similarComponentExtended.css = differentStyle
          similarComponentExtended.extendedFrom = baseComponent

          styledComponentsFromScratch = styledComponentsFromScratch.filter(
            component => component.name !== similarComponent!.name
          )
          styledComponentsFromExistingComponent = styledComponentsFromExistingComponent.filter(
            component => component.name !== similarComponent!.name
          )
          styledComponentsFromExistingComponent.push(similarComponentExtended)
        } else {
          // The current component's style is a superset of similarComponent's style
          baseComponent = similarComponent
        }

        styledComponentsFromExistingComponent.push({
          name,
          tagName,
          extendedFrom: baseComponent,
          css: Object.fromEntries(Object.entries(cssObject).filter(([property]) => !(property in commonStyle)))
        })
      } else {
        styledComponentsFromScratch.push({ name, tagName, css: cssObject })
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