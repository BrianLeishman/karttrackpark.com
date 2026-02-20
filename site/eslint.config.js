// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        ignores: [
            'node_modules/**',
            'assets/js/**',
            'public/**',
            '**/*.d.ts',
            '**/*.js',
        ],
    },
    {
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            '@stylistic': stylistic,
        },
        languageOptions: {
            globals: {
                ...globals.browser,
            },
            parser: tseslint.parser,
            parserOptions: {
                project: ['tsconfig.json'],
            },
        },
        rules: {
            // Semicolons and quotes
            'semi': [2, 'always'],
            'quotes': ['error', 'single', { 'avoidEscape': true }],

            // Naming conventions
            '@typescript-eslint/naming-convention': [
                'error',
                { 'selector': 'variable', 'modifiers': ['const'], 'format': ['camelCase', 'PascalCase', 'UPPER_CASE'] },
                { 'selector': ['default'], 'format': ['camelCase'] },
                { 'selector': ['default'], 'format': ['PascalCase'], 'modifiers': ['exported'] },
                { 'selector': ['classMethod', 'classProperty', 'parameterProperty'], 'format': ['camelCase'], 'modifiers': ['public'] },
                { 'selector': ['default'], 'modifiers': ['requiresQuotes'], 'format': ['camelCase', 'PascalCase'] },
                { 'selector': ['typeParameter'], 'format': ['PascalCase'] },
                { 'selector': ['classProperty', 'objectLiteralProperty', 'typeProperty', 'classMethod', 'objectLiteralMethod', 'typeMethod', 'accessor', 'enumMember'], 'format': null, 'modifiers': ['requiresQuotes'] },
                { 'selector': 'objectLiteralProperty', 'format': null },
                { 'selector': 'typeProperty', 'format': null },
                { 'selector': 'typeMethod', 'format': null },
                { 'selector': 'function', 'format': ['camelCase'] },
                { 'selector': 'interface', 'format': ['PascalCase'] },
                { 'selector': 'typeAlias', 'format': ['PascalCase'] },
                { 'selector': 'default', 'format': null, 'filter': { 'regex': '^_$', 'match': true } },
                { 'selector': 'import', 'format': null },
                { 'selector': 'class', 'format': ['PascalCase'] },
            ],

            // Type safety
            '@typescript-eslint/no-explicit-any': ['error', { 'ignoreRestArgs': true }],
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
            '@typescript-eslint/no-unused-expressions': 'error',
            '@typescript-eslint/no-unnecessary-template-expression': 'error',
            '@typescript-eslint/no-misused-promises': ['error', { 'checksVoidReturn': false }],
            '@typescript-eslint/restrict-template-expressions': ['error', {
                'allowNumber': true,
                'allowBoolean': false,
                'allowAny': false,
                'allowNullish': false,
            }],
            '@typescript-eslint/restrict-plus-operands': ['error', {
                allowAny: false,
                allowBoolean: false,
                allowNullish: false,
                allowNumberAndString: false,
                allowRegExp: false,
            }],
            '@typescript-eslint/consistent-type-assertions': ['error', {
                assertionStyle: 'as',
                objectLiteralTypeAssertions: 'never',
            }],
            '@typescript-eslint/no-deprecated': 'warn',

            // No enums, use #private
            'no-restricted-syntax': [
                'error',
                { 'selector': 'TSEnumDeclaration', 'message': 'Don\'t declare enums' },
                { 'selector': 'MethodDefinition[accessibility="private"]:not([kind="constructor"])', 'message': 'Use #private methods instead of private keyword' },
                { 'selector': 'PropertyDefinition[accessibility="private"]', 'message': 'Use #private properties instead of private keyword' },
            ],

            // Arrow functions
            'prefer-arrow-callback': 'error',
            'arrow-parens': ['error', 'as-needed'],
            'arrow-body-style': ['error', 'as-needed'],
            'arrow-spacing': 'error',

            // General
            'no-console': ['error', { 'allow': ['warn', 'error'] }],
            'no-implicit-coercion': 'error',
            'no-extra-boolean-cast': 'error',
            'no-nested-ternary': 'error',
            'eqeqeq': ['error', 'always'],
            'no-self-compare': 'error',
            'no-unneeded-ternary': 'error',
            'curly': ['error', 'all'],
            'radix': 'error',
            'no-constant-condition': ['error', { 'checkLoops': false }],
            'no-unused-vars': 'off',
            'no-unused-expressions': 'off',

            // Stylistic
            '@stylistic/indent': ['error', 4, { 'SwitchCase': 0, 'ignoredNodes': ['TemplateLiteral *'] }],
            '@stylistic/comma-dangle': ['error', {
                'arrays': 'always-multiline',
                'objects': 'always-multiline',
                'imports': 'always-multiline',
                'exports': 'always-multiline',
                'functions': 'always-multiline',
            }],
            '@stylistic/member-delimiter-style': ['error', {
                'multiline': { 'delimiter': 'semi', 'requireLast': true },
                'singleline': { 'delimiter': 'semi', 'requireLast': false },
            }],
            '@stylistic/comma-spacing': ['error'],
            '@stylistic/function-call-spacing': ['error'],
            '@stylistic/function-call-argument-newline': ['error', 'consistent'],
            '@stylistic/array-bracket-spacing': ['error'],
            '@stylistic/no-extra-parens': ['error', 'all', { 'nestedBinaryExpressions': false }],
            '@stylistic/space-in-parens': ['error'],
            '@stylistic/space-before-function-paren': ['error', {
                'anonymous': 'always',
                'named': 'never',
                'asyncArrow': 'always',
            }],
            '@stylistic/brace-style': ['error'],
            '@stylistic/dot-location': ['error'],
            '@stylistic/template-curly-spacing': ['error'],
            '@stylistic/max-statements-per-line': ['error', { 'max': 1 }],
            '@stylistic/object-property-newline': ['error', { 'allowAllPropertiesOnSameLine': true }],
            'object-curly-spacing': ['error', 'always'],
            'no-multiple-empty-lines': ['error', { 'max': 1, 'maxEOF': 0, 'maxBOF': 0 }],
            'padded-blocks': ['error', { 'blocks': 'never', 'classes': 'never', 'switches': 'never' }],

            // Turned off
            '@typescript-eslint/no-extraneous-class': 'off',
            '@typescript-eslint/class-literal-property-style': 'off',
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
            '@typescript-eslint/non-nullable-type-assertion-style': 'off',
            '@typescript-eslint/dot-notation': 'off',
            '@typescript-eslint/prefer-nullish-coalescing': 'off',
            '@typescript-eslint/no-meaningless-void-operator': 'error',
            'prefer-promise-reject-errors': 'off',
            '@typescript-eslint/prefer-promise-reject-errors': 'off',
            'no-throw-literal': 'off',
            '@typescript-eslint/only-throw-error': 'off',
        },
    },
);
