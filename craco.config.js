module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Find and remove the existing rule that handles .glsl files as assets
      const fileLoaderRule = webpackConfig.module.rules.find(
        (rule) => rule.oneOf
      );

      if (fileLoaderRule) {
        // Insert raw-loader rule for .glsl files before the file-loader fallback
        fileLoaderRule.oneOf.unshift({
          test: /\.glsl$/,
          type: 'asset/source',
        });
      }

      return webpackConfig;
    },
  },
};
