# style-attribute-to-styled-component-codemod

A [jscodeshift](https://github.com/facebook/jscodeshift) codemod to migrate from style attributes to [styled-components](https://github.com/styled-components/styled-components).

## Prerequireties

jscodeshift installed globally.

```
npm install -global jscodeshift
```

## Usage

To migrate all `jsx` files within `src` directory:

```
jscodeshift -t /path/to/codemod.ts src/**/*.jsx
```

You should re-format your code after running the codemod.

## Known limitions

- Styles declared with spread operator are not supported.
- Computed CSS properties and values are skipped.

## License

MIT
