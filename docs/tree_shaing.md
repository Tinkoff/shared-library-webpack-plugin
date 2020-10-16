# Sharing and Tree shaking

Tree shaking is dead-code elimination. [Read more](https://webpack.js.org/guides/tree-shaking/)

Because the plugin doesn't know which the library part will use in another application, it disabled tree shaking. Therefore bundles become large.

For the solution, the plugin provides an usedExports option. It can be an array of import names to be used by another application. See the example in [the demo](https://github.com/IKatsuba/shared-library-plugin-demo/blob/master/apps/code-of-conduct/extra-webpack.config.js).

