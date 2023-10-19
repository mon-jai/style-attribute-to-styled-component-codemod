# style-attribute-to-styled-component-codemod

A [jscodeshift](https://github.com/facebook/jscodeshift) codemod for migrating from style attributes to [styled-components](https://github.com/styled-components/styled-components).

## Prerequisites

[jscodeshift](https://www.npmjs.com/package/jscodeshift) installed globally.

```sh
npm install -g jscodeshift
```

## Usage

To migrate all `jsx` files within the `src` directory:

```sh
jscodeshift -t /path/to/codemod.ts src/**/*.jsx [--similar-components-minimum-common-declarations COUNT]

--similar-components-minimum-common-declarations
  Specifies the minimum number of common declarations required to determine whether components should be extended from a common base.
```

You should reformat your code after running the codemod.

## Known Limitations

- Style objects declared with the spread operator are not supported.
- Dynamically computed CSS properties and values are skipped.

## License

[MIT](LICENSE)
