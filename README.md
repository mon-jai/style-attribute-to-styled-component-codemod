# style-attribute-to-styled-component-codemod

A [jscodeshift](https://github.com/facebook/jscodeshift) codemod to migrate from style attributes to [styled-components](https://github.com/styled-components/styled-components).

## Installation

```
npm install -global style-attribute-to-styled-component-codemod
```

## Usage

To migrate all `jsx` files within `src` directory:

```
style-attribute-to-styled-component-codemod src/**/*.jsx
```

## Known limitions

- Styles declared with spread operator are not supported.
- Computed CSS properties and values are skipped.

## License

MIT
