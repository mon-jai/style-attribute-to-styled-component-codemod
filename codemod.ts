function lastIndexOfRegex(string, regex, lastIndex = -1) {
  // https://stackoverflow.com/a/273810
  const index = string.search(regex)
  return index === -1 ? lastIndex : lastIndexOfRegex(string.slice(index + 1), regex, index)
}

/**
 * @param {import("jscodeshift").FileInfo} file
 * @param {import("jscodeshift").API} api
 * @param {import("jscodeshift").Options} options
 * @returns {string | void}
 */
module.exports = function transformer(file, api, _options) {
  const { jscodeshift } = api
  const root = jscodeshift(file.source)

  let hasModifications = false
  const styledComponentsToCreate = []

  root.find(jscodeshift.JSXElement).forEach(jsxElement => {
    const { openingElement, closingElement } = jsxElement.__childCache
    const attributes = openingElement.node.attributes

    let tagName = openingElement.value.name.name
    if (tagName === undefined) return
    if (tagName.charAt(0).match(/[A-Z]/)) return

    const styleAttributeIndex = attributes.findIndex(attr => attr?.name?.name === "style")
    if (styleAttributeIndex === -1) return

    const styleAttribute = attributes[styleAttributeIndex]
    if (styleAttribute.value.expression?.type !== "ObjectExpression") return
    if (styleAttribute.value.expression.properties.find(property => property.type !== "Property")) return

    hasModifications = true

    // If styleAttribute is an empty object, delete the attribute but do not replace it with a styled component
    if (styleAttribute.value.expression.properties.length === 0) {
      delete openingElement.node.attributes[styleAttributeIndex]
      return
    }

    const cssObjectEntries = []
    for (let i = 0; i < styleAttribute.value.expression.properties.length; i++) {
      const { key, value } = styleAttribute.value.expression.properties[i]

      // Identifier key: { color: red }
      // Literal key: { "color": red }
      if ((key.type !== "Identifier" && key.type !== "Literal") || value.type !== "Literal") {
        // Style attribute with JavaScript code needed too be rewritten manually.
        continue
      }

      const cssKey = (key.type === "Identifier" ? key.name : key.value).replaceAll(
        /[A-Z]/g,
        match => `-${match.toLowerCase()}`
      )
      const cssValue = value.value

      cssObjectEntries.push([cssKey, cssValue])
      delete styleAttribute.value.expression.properties[i]
    }
    const cssObject = Object.fromEntries(cssObjectEntries)

    let componentName
    for (let i = 0; ; i++) {
      componentName = `${tagName.charAt(0).toUpperCase()}${tagName.slice(1)}${i}`
      if (!styledComponentsToCreate.find(componentToCreate => componentToCreate.componentName === componentName)) break
    }

    // Delete styleAttribute if there is no property left
    if (styleAttribute.value.expression.properties.every(property => property === undefined)) {
      delete openingElement.node.attributes[styleAttributeIndex]
    }

    // Replace element with a styled component
    styledComponentsToCreate.push({ componentName, tagName, cssValue: cssObject })
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
      ...styledComponentsToCreate.map(({ componentName, tagName, cssValue }) => {
        const cssString = Object.entries(cssValue)
          .map(([key, value]) => `  ${key}: ${value};`)
          .join("\n")
        return `const ${componentName} = styled.${tagName}\`\n${cssString}\n\`\n`
      }),
    ].join("\n") +
    source.slice(lastImportEnd)
  )
}