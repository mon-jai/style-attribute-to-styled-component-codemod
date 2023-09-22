# style-attribute-to-styled-component-codemod

A [jscodeshift](https://github.com/facebook/jscodeshift) codemod to migrate from style attributes to [styled-components](https://github.com/styled-components/styled-components).

## Prerequireties

jscodeshift and loadsh installed globally

```
npm install -global jscodeshift loadsh
```

## Usage

To migrate all files within src directory:

```
jscodeshift -t codemod.ts src/**/*.[js|jsx|ts|tsx]
```

## Known limitions

- Computed css key and values is not edited
- Spread operator is not edited

## License

MIT