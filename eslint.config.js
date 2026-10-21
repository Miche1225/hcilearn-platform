const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      // \x01/\x02 are used on purpose as placeholder markers in richtext parsing
      'no-control-regex': 'off',
    },
  },
  {
    files: ['eslint.config.js', 'server.js', 'src/**/*.js', 'scripts/**/*.js', '.claude/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    // Plain global scripts that share variables across files (api, requireAuth, ...)
    files: ['public/js/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
    rules: { 'no-undef': 'off', 'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }] },
  },
];
