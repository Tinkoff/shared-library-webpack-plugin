# Installation and Configuration

## Installation

The plugin can install by any package manager.

```
npm i @tinkoff/shared-library-webpack-plugin -D
```

or

```
yarn add @tinkoff/shared-library-webpack-plugin --dev
```

## Configuration

Add plugin to webpack configuration file and set a list of libraries for sharing. There is an example with `lodash`:

```typescript
import { SharedLibraryWebpackPlugin } from '@tinkoff/shared-library-webpack-plugin';

module.exports = {
  plugin: [
    new SharedLibraryWebpackPlugin({
      libs: 'lodash',
    }),
  ],
};
```

The plugin adds one more chunk with a hashed name to the bundle. It should be a shared lodash. When the application is loaded, the webpack runtime will check if lodash is loaded.

## [How is it works?](./how_is_it_works.md)
