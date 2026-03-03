// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { ESLintUtils } from '@typescript-eslint/utils';
import * as ts from 'typescript';

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        // Global ignores
        ignores: [
            '**/node_modules/**',
            '**/assets/js/**',
            '**/public/**',
            '**/*.d.ts',
            '**/*.js',
        ],
    },
    {
        // Configuration for all files
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            '@stylistic': stylistic,
            'local': {
                rules: {
                    'no-pascalcase-in-non-declared-types': {
                        create(context) {
                            return {
                                /** @param {any} node */
                                TSPropertySignature(node) {
                                    // Get the property name
                                    if (node.key.type !== 'Identifier') {
                                        return;
                                    }

                                    const propertyName = node.key.name;

                                    // Check if it starts with uppercase (PascalCase)
                                    if (!/^[A-Z]/.test(propertyName)) {
                                        return;
                                    }

                                    // Walk up the AST to find parent interface/type declaration
                                    let parent = node.parent;
                                    while (parent) {
                                        if (parent.type === 'TSInterfaceBody') {
                                            parent = parent.parent;
                                            continue;
                                        }

                                        if (parent.type === 'TSInterfaceDeclaration' || parent.type === 'TSTypeAliasDeclaration') {
                                            // Check if it has the declare keyword
                                            if (parent.declare === true) {
                                                // It's declared - allow any naming
                                                return;
                                            }

                                            // Not declared - report error
                                            context.report({
                                                node: node.key,
                                                message: `Type property name '${propertyName}' must be in camelCase. Use 'declare interface' for external APIs that require PascalCase.`,
                                            });
                                            return;
                                        }

                                        parent = parent.parent;
                                    }
                                },
                                /** @param {any} node */
                                TSMethodSignature(node) {
                                    // Get the method name
                                    if (node.key.type !== 'Identifier') {
                                        return;
                                    }

                                    const methodName = node.key.name;

                                    // Check if it starts with uppercase (PascalCase)
                                    if (!/^[A-Z]/.test(methodName)) {
                                        return;
                                    }

                                    // Walk up the AST to find parent interface/type declaration
                                    let parent = node.parent;
                                    while (parent) {
                                        if (parent.type === 'TSInterfaceBody') {
                                            parent = parent.parent;
                                            continue;
                                        }

                                        if (parent.type === 'TSInterfaceDeclaration' || parent.type === 'TSTypeAliasDeclaration') {
                                            // Check if it has the declare keyword
                                            if (parent.declare === true) {
                                                // It's declared - allow any naming
                                                return;
                                            }

                                            // Not declared - report error
                                            context.report({
                                                node: node.key,
                                                message: `Type method name '${methodName}' must be in camelCase. Use 'declare interface' for external APIs that require PascalCase.`,
                                            });
                                            return;
                                        }

                                        parent = parent.parent;
                                    }
                                },
                                /** @param {any} node */
                                Property(node) {
                                    // Only check object literal properties (not method definitions)
                                    if (node.method || node.kind !== 'init') {
                                        return;
                                    }

                                    // If property is quoted (Literal), allow any naming (external API)
                                    if (node.key.type === 'Literal') {
                                        return;
                                    }

                                    // If property key is an Identifier and starts with uppercase
                                    if (node.key.type === 'Identifier') {
                                        const propertyName = node.key.name;

                                        // Allow SCREAMING_SNAKE_CASE (all uppercase with underscores)
                                        if (/^[A-Z][A-Z0-9_]*$/.test(propertyName)) {
                                            return;
                                        }

                                        if (/^[A-Z]/.test(propertyName)) {
                                            // Check if object literal is typed as a declared interface
                                            try {
                                                const services = ESLintUtils.getParserServices(context);

                                                // Get the parent object expression
                                                const objectExpr = node.parent;

                                                // Get the contextual type of the object literal (the type it's being assigned to)
                                                const checker = services.program.getTypeChecker();
                                                const tsNode = services.esTreeNodeToTSNodeMap.get(objectExpr);
                                                const contextualType = checker.getContextualType(/** @type {any} */ (tsNode));

                                                if (contextualType) {
                                                    // Check if this type comes from a declared interface
                                                    const symbol = contextualType.getSymbol();
                                                    if (symbol) {
                                                        const declarations = symbol.getDeclarations();
                                                        if (declarations) {
                                                            for (const decl of declarations) {
                                                                // Check if declaration has 'declare' modifier (ambient)
                                                                if (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Ambient) {
                                                                    // It's from a declared interface - allow!
                                                                    return;
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            } catch (e) {
                                                // Fall through to report error if type checking fails
                                            }

                                            context.report({
                                                node: node.key,
                                                message: `Object literal property '${propertyName}' must be in camelCase. Use quoted properties for external APIs that require PascalCase.`,
                                            });
                                        }
                                    }
                                },
                            };
                        },
                    },
                },
            },
        },
        languageOptions: {
            globals: {
                ...globals.browser,
            },
            parser: tseslint.parser,
            parserOptions: ({
                project: ['**/tsconfig.json'], // ← array of globs
                tsconfigRootDir: repoRoot      // ← sibling, not nested
            })
        },
        rules: {
            'local/no-pascalcase-in-non-declared-types': 'error',
            '@typescript-eslint/no-deprecated': 'warn',
            'semi': [2, 'always'],
            '@typescript-eslint/no-misused-promises': [
                'error',
                {
                    'checksVoidReturn': false,
                },
            ],
            '@typescript-eslint/naming-convention': [
                'error',
                { 'selector': 'variable', 'modifiers': ['const'], 'format': ['camelCase', 'PascalCase', 'UPPER_CASE'] },
                { 'selector': ['default'], 'format': ['camelCase'] },
                { 'selector': ['default'], 'format': ['PascalCase'], 'modifiers': ['exported'] },
                { 'selector': 'function', 'format': ['camelCase', 'PascalCase'], 'modifiers': ['exported'] },
                { 'selector': ['classMethod', 'classProperty', 'parameterProperty'], 'format': ['camelCase'], 'modifiers': ['public'] },
                { 'selector': ['default'], 'modifiers': ['requiresQuotes'], 'format': ['camelCase', 'PascalCase'] },
                { 'selector': ['typeParameter'], 'format': ['PascalCase'] },
                { 'selector': ['classProperty', 'objectLiteralProperty', 'typeProperty', 'classMethod', 'objectLiteralMethod', 'typeMethod', 'accessor', 'enumMember'], 'format': null, 'modifiers': ['requiresQuotes'] },
                { 'selector': 'objectLiteralProperty', 'format': null },
                { 'selector': 'typeProperty', 'format': null },
                { 'selector': 'typeMethod', 'format': null },
                { 'selector': 'classMethod', 'format': null, 'filter': { 'regex': 'toString', 'match': true } },
                { 'selector': 'function', 'format': ['camelCase'], 'filter': { 'regex': '[Mm][Aa][Ii][Nn]', 'match': true } },
                { 'selector': 'interface', 'format': ['PascalCase'] },
                { 'selector': 'typeAlias', 'format': ['PascalCase'] },
                { 'selector': 'default', 'format': null, 'filter': { 'regex': '^_$', 'match': true } },
                { 'selector': 'import', 'format': null },
                { 'selector': 'class', 'format': ['PascalCase'] },
            ],
            '@typescript-eslint/no-extraneous-class': 'off',
            '@typescript-eslint/class-literal-property-style': 'off',
            'no-undefined': 'off',
            'prefer-arrow-callback': 'error',
            'arrow-parens': ['error', 'as-needed'],
            'arrow-body-style': ['error', 'as-needed'],
            'arrow-spacing': 'error',
            '@typescript-eslint/no-inferrable-types': 'off',
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
            'no-unused-expressions': 'off',
            '@typescript-eslint/no-unused-expressions': 'error',
            'no-implicit-coercion': 'error',
            'no-extra-boolean-cast': 'error',
            '@typescript-eslint/no-unnecessary-template-expression': 'error',
            '@typescript-eslint/no-explicit-any': ['error', { 'ignoreRestArgs': true }],
            '@typescript-eslint/no-non-null-assertion': 'error',
            'radix': 'error',
            'no-restricted-syntax': [
                'error',
                {
                    'selector': 'TSEnumDeclaration',
                    'message': 'Don\'t declare enums',
                },
                {
                    'selector': 'MethodDefinition[accessibility="private"]:not([kind="constructor"])',
                    'message': 'Use #private methods instead of private keyword',
                },
                {
                    'selector': 'PropertyDefinition[accessibility="private"]',
                    'message': 'Use #private properties instead of private keyword',
                },
            ],
            '@stylistic/comma-dangle': ['error', {
                'arrays': 'always-multiline',
                'objects': 'always-multiline',
                'imports': 'always-multiline',
                'exports': 'always-multiline',
                'functions': 'always-multiline',
            }],
            'no-console': ['error', { 'allow': ['warn', 'error'] }],
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
            '@typescript-eslint/no-meaningless-void-operator': 'error',
            'no-nested-ternary': 'error',
            'eqeqeq': ['error', 'always'],
            'no-self-compare': 'error',
            'no-unneeded-ternary': 'error',
            'curly': ['error', 'all'],
            'no-multiple-empty-lines': ['error', { 'max': 1, 'maxEOF': 0, 'maxBOF': 0 }],
            'padded-blocks': ['error', { 'blocks': 'never', 'classes': 'never', 'switches': 'never' }],
            'quotes': ['error', 'single', { 'avoidEscape': true }],
            'object-curly-spacing': ['error', 'always'],
            '@stylistic/member-delimiter-style': ['error', {
                'multiline': { 'delimiter': 'semi', 'requireLast': true },
                'singleline': { 'delimiter': 'semi', 'requireLast': false },
            }],
            '@typescript-eslint/restrict-template-expressions': [
                'error',
                {
                    'allowNumber': true,
                    'allowBoolean': false,
                    'allowAny': false,
                    'allowNullish': false,
                    'allowRegExp': false,
                    'allowNever': false,
                },
            ],
            '@stylistic/indent': ['error', 4, { 'SwitchCase': 0, 'ignoredNodes': ['TemplateLiteral *'] }],
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
            '@stylistic/operator-linebreak': ['error', 'after'],
            '@stylistic/dot-location': ['error'],
            '@stylistic/template-curly-spacing': ['error'],
            '@typescript-eslint/non-nullable-type-assertion-style': 'off',
            '@typescript-eslint/dot-notation': 'off',
            '@typescript-eslint/restrict-plus-operands': ['error', {
                allowAny: false,
                allowBoolean: false,
                allowNullish: false,
                allowNumberAndString: false,
                allowRegExp: false,
            }],
            '@typescript-eslint/prefer-nullish-coalescing': 'off',
            'no-constant-condition': ['error', { 'checkLoops': false }],
            '@typescript-eslint/consistent-type-assertions': [
                'error', {
                    assertionStyle: 'never',
                },
            ],
            'prefer-promise-reject-errors': 'off',
            '@typescript-eslint/prefer-promise-reject-errors': 'off',
            'no-throw-literal': 'off',
            '@typescript-eslint/only-throw-error': 'off',
            '@stylistic/max-statements-per-line': [
                'error',
                {
                    'max': 1,
                },
            ],
            '@stylistic/object-property-newline': [
                'error',
                {
                    'allowAllPropertiesOnSameLine': true,
                },
            ],
        },
    }
);
