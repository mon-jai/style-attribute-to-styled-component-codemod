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

    let cssValue
    try {
      cssValue = Object.fromEntries(
        styleAttribute.value.expression.properties.map(property => {
          const { key, value } = property
          if (key.type !== "Identifier" || value.type !== "Literal") {
            throw `${file.path}: Style attribute with JavaScript code needed too be rewritten manually.`
          }
          return [key.name, value.value]
        })
      )
    } catch (error) {
      console.log(error)
      return
    }

    let componentName
    for (let i = 0; ; i++) {
      componentName = `${tagName.charAt(0).toUpperCase()}${tagName.slice(1)}${i}`
      if (!styledComponentsToCreate.find(componentToCreate => componentToCreate.componentName === componentName)) break
    }

    hasModifications = true
    styledComponentsToCreate.push({ componentName, tagName, cssValue })
    delete openingElement.node.attributes[styleAttributeIndex]

    openingElement.value.name.name = componentName
    try {
      closingElement.value.name.name = componentName
    } catch {}
  })

  if (!hasModifications) return

  const source = root.toSource()

  let lastImportStart = lastIndexOfRegex(source, /^import +[A-Za-z0-9\{\} ]+ from/m)
  let lastImportEnd = lastImportStart + source.slice(lastImportStart).indexOf("\n")
  if (lastImportStart === -1) {
    lastImportStart = 0
    lastImportEnd = 0
  }

  return (
    source.slice(0, lastImportEnd) +
    [
      source.search(/import.*styled.*from\s*['"]styled-components['"]/m) === -1
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
