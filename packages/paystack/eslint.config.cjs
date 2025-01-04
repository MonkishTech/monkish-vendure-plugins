const baseConfig = require('../../eslint.config.cjs');

module.exports = [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredDependencies: [
            '@nestjs/common',
            '@nestjs/graphql',
            'express',
            '@vendure/core',
            '@vendure/admin-ui-plugin',
            '@vendure/common',
            '@vendure/testing',
            'dotenv',
            'graphql',
            'graphql-tag',
            'gql.tada',
            'nock',
          ],
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs}',
            '{projectRoot}/vite.config.{js,ts,mjs,mts}',
          ],
        },
      ],
    },
    languageOptions: {
      parser: require('jsonc-eslint-parser'),
    },
  },
];
