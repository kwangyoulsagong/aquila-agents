import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Feature-Sliced Design: a layer may import only from layers BELOW it, and other slices only via their index.
const LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'];
const fsdBoundaries = LAYERS.map((layer, i) => {
  const above = LAYERS.slice(0, i);
  const sameLayerSlices = layer === 'app' || layer === 'shared' ? [] : [`@/${layer}/*`];
  return {
    files: [`src/${layer}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...(above.length
              ? [
                  {
                    group: above.map((l) => `@/${l}/**`),
                    message: `${layer} must not import from upper layers (${above.join(', ')}).`,
                  },
                ]
              : []),
            {
              group: ['@/*/*/*', '!@/shared/**'],
              message:
                'Import other slices through their public index (e.g. @/entities/session), not deep paths.',
            },
            ...(sameLayerSlices.length
              ? [{ group: sameLayerSlices, message: `Slices in ${layer} must not import each other.` }]
              : []),
            { group: ['../../*', '../../../*'], message: 'Use the @/ alias across slices.' },
          ],
        },
      ],
    },
  };
});

export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'node_modules', 'release'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'design-system/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  ...fsdBoundaries,
  // The design system sits below every layer: it must not import app code.
  {
    files: ['design-system/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/*', '**/src/**'], message: 'design-system must not import from src/.' }] },
      ],
    },
  },
  { files: ['electron/**/*.ts'], languageOptions: { globals: globals.node } },
);
