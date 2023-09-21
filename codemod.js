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

    if (openingElement.value.name.name.charAt(0).match(/[A-Z]/)) return

    const styleAttributeIndex = attributes.findIndex(attr => attr?.name?.name === "style")
    if (styleAttributeIndex === -1) return

    const styleAttribute = attributes[styleAttributeIndex]
    if (styleAttribute.value.expression?.type !== "ObjectExpression") return

    const cssValue = Object.fromEntries(
      styleAttribute.value.expression.properties.map(({ key: { name }, value: { value } }) => [name, value])
    )

    let tagName = openingElement.value.name.name
    let componentName

    for (let i = 0; ; i++) {
      componentName = `${tagName.charAt(0).toUpperCase()}${tagName.slice(1)}${i}`
      if (!styledComponentsToCreate.find(componentToCreate => componentToCreate.componentName === componentName)) break
    }

    styledComponentsToCreate.push({ componentName, tagName, cssValue })

    delete openingElement.node.attributes[styleAttributeIndex]
    hasModifications = true

    openingElement.value.name.name = componentName
    closingElement.value.name.name = componentName
  })

  if (!hasModifications) return

  const source = root.toSource()

  let lastImportStart = source.lastIndexOf("import")
  let lastImportEnd = source.slice(lastImportStart).indexOf("\n")
  if (lastImportStart === -1 || lastImportEnd == -1) {
    lastImportStart = 0
    lastImportEnd = 0
  }

  return (
    source.slice(0, lastImportEnd) +
    [
      'import styled from "styled-components"\n',
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
