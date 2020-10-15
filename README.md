---
description: >-
  SharedLibraryWebpackPlugin is a webpack plugin for sharing libraries between
  applications.
---

# SharedLibraryWebpackPlugin

[![npm](https://img.shields.io/npm/v/@tinkoff/shared-library-webpack-plugin)](https://www.npmjs.com/package/@tinkoff/shared-library-webpack-plugin) [![npm](https://img.shields.io/npm/dm/@tinkoff/shared-library-webpack-plugin)](https://www.npmjs.com/package/@tinkoff/shared-library-webpack-plugin)

### Motivation

When the host application loads many micro apps bundled with a webpack, many JavaScript is loaded on a client page. In a perfect world, each app can share its libraries with other apps and meet the requirements:

1. Each app stays self-hosted.
2. Fallbacks for non-loaded packages.
3. Codesharing in runtime.
4. Different library versions work individually.

SharedLibraryWebpackPlugin came to us from a perfect world!

### Documentations

1. [Installation and configuration](docs/installation_and_configuration.md)
2. [How is it works?](docs/how_is_it_works.md)
3. [Sharing and Tree shaking](https://github.com/TinkoffCreditSystems/shared-library-webpack-plugin/tree/15f229429eaf4e9adedbd15b405686a142d0087e/docs/tree_shaking.md)

### Demo

There is [a host application with two micro-apps](https://github.com/IKatsuba/shared-library-plugin-demo). All apps are built with Angular. The client page loads 282.8kB of JavaScript \(gzip\) when it opens all pages.

We add SharedLibraryWebpackPlugin in each app build for sharing all Angular packages and zone.js.

```typescript
const {
  SharedLibraryWebpackPlugin,
} = require('@tinkoff/shared-library-webpack-plugin');

module.exports = {
  plugins: [
    new SharedLibraryWebpackPlugin({
      libs: [
        { name: '@angular/core', usedExports: [] },
        { name: '@angular/common', usedExports: [] },
        { name: '@angular/common/http', usedExports: [] },
        { name: '@angular/platform-browser', usedExports: ['DomSanitizer'] },
        { name: '@angular/platform-browser/animations', usedExports: [] },
        { name: '@angular/animations', usedExports: [] },
        { name: '@angular/animations/browser', usedExports: [] },
        'zone.js/dist/zone',
      ],
    }),
  ],
};
```

After that, the client page loads 174.6kB of JavaScript! It is 38% less!

### [Contributing](contributing.md)

### [License](license.md)

