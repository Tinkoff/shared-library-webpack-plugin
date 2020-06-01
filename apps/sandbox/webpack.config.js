const {
  SharedLibraryWebpackPlugin,
} = require('../../dist/libs/shared-library-webpack-plugin');

module.exports = function (config, { options }) {
  config.plugins.push(
    new SharedLibraryWebpackPlugin({
      libs: ['minimatch', 'lodash'],
    })
  );

  return config;
};
