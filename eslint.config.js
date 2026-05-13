import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', '.next/**/*', 'coverage/**/*']
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
