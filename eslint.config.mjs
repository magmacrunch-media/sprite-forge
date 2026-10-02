// eslint.config.js — flat config, replacing .eslintrc.json.
//
// The rules below are that file's, carried across unchanged. What had rotted
// was everything around them: ESLint 9 dropped .eslintrc entirely, so the
// config was being ignored and `npm run lint` failed before it read a line of
// code, and package.json still pointed at core/ and ui/ at the repo root,
// which have lived under app/ since the Tauri bundle work. Both are fixed
// here — the file list is this file's job now, so the script is just `eslint`.
//
// Three kinds of file, and the difference matters:
//
//   app/        classic scripts, no modules, attaching to window.SpriteForge.
//               See AGENTS.md — this is deliberate and not to be converted, so
//               sourceType stays "script" and an `import` here is an error
//               rather than a style choice.
//   tests/      ESM on Node, with the browser shimmed by hand in harness.mjs.
//   scripts/    ESM on Node, development-time only, never in the bundle.
//
// desktop/ is Rust plus its own JS package and is not linted from here.

const browser = {
    window: 'writable', document: 'readonly', console: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly',
    setInterval: 'readonly', clearInterval: 'readonly',
    requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
    Image: 'readonly', ImageData: 'readonly', URL: 'readonly', Blob: 'readonly',
    FileReader: 'readonly', fetch: 'readonly', navigator: 'readonly',
    localStorage: 'readonly', location: 'readonly', alert: 'readonly',
    confirm: 'readonly', prompt: 'readonly',
    KeyboardEvent: 'readonly', MouseEvent: 'readonly', Event: 'readonly',
    MutationObserver: 'readonly', CustomEvent: 'readonly',
    // The app's own globals, which are not on window by accident: core/ and
    // ui/ are classic scripts that publish themselves this way.
    SpriteForge: 'writable', CharacterTemplates: 'readonly', Toast: 'readonly',
    // The vendored kit, which app/ files call but do not define.
    MagmaKit: 'readonly',
};

const node = {
    console: 'readonly', process: 'readonly', Buffer: 'readonly',
    __dirname: 'readonly', __filename: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly',
    setInterval: 'readonly', clearInterval: 'readonly',
    URL: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
};

// Carried over from .eslintrc.json verbatim.
const rules = {
    'no-unused-vars': ['warn', { args: 'none' }],
    'no-undef': 'error',
    'no-redeclare': 'warn',
    'no-duplicate-case': 'error',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-unreachable': 'error',
    'no-constant-condition': 'warn',
    'no-extra-semi': 'error',
    'no-dupe-keys': 'error',
    'no-shadow-restricted-names': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
    eqeqeq: ['warn', 'smart'],
    'no-caller': 'error',
    'no-eval': 'warn',
    'no-implied-eval': 'warn',
    'no-new-wrappers': 'error',
    'no-throw-literal': 'warn',
    'no-self-compare': 'warn',
    'no-unused-expressions': 'warn',
    'no-useless-call': 'warn',
    'no-useless-concat': 'warn',
    'no-useless-escape': 'warn',
    'no-with': 'error',
    'no-loop-func': 'warn',
    'no-new-func': 'warn',
};

export default [
    {
        // app/kit/ and tests/kit/ are vendored from magma-kit and linted
        // there; app/shell/ is vendored from the website the same way.
        // pwa/dist/ is assembled by scripts/package-pwa.mjs out of files that
        // are linted at their source, so linting the copies would report every
        // finding twice and grade a generated sw.js whose two fields are
        // substituted text rather than anything anyone wrote.
        ignores: ['node_modules/**', 'desktop/**', '.claude/**', 'app/shell/**',
            'app/kit/**', 'tests/kit/**', 'pwa/dist/**'],
    },
    {
        files: ['app/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: browser,
        },
        rules,
    },
    {
        // pwa/ is a fourth kind: classic scripts like app/, but running in a
        // service worker rather than a page, so `self` and `caches` are the
        // globals and `window` is absent from one of the two files. Shipped
        // code, so it is linted; without this block it matched no `files`
        // pattern and was the only runtime JS in the repo nothing graded.
        files: ['pwa/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: {
                ...browser,
                self: 'readonly', caches: 'readonly', Response: 'readonly',
                /* sw.js is a template: package-pwa.mjs substitutes this for the
                   precache array. Declared rather than written as a valid-JS
                   placeholder on purpose. `var PRECACHE = [];` would lint
                   without this line and would also mean that a worker which
                   somehow reached a browser unsubstituted had no precache list
                   and therefore no offline, quietly. An undefined identifier
                   throws on the first install instead, which is the failure
                   this repo prefers. package-pwa.mjs's fill() refuses to emit
                   an unsubstituted worker in the first place. */
                __PRECACHE__: 'readonly',
            },
        },
        rules,
    },
    {
        files: ['tests/**/*.mjs', 'scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: node,
        },
        rules,
    },
];
