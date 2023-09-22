# style-attribute-to-styled-component-codemod

A [jscodeshift](https://github.com/facebook/jscodeshift) codemod to migrate from style attributes to [styled-components](https://github.com/styled-components/styled-components).

## Prerequireties

- jscodeshift and loadsh installed globally.

```
npm install -global jscodeshift loadsh
```

## Usage

To migrate all `jsx` files within `src` directory:

```
jscodeshift -t codemod.ts src/**/*.jsx
```

## Known limitions

- Computed CSS properties and values are not migrated.
- Declarations within spread operator are not migrated.

## License

MIT