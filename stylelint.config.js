/** Theming rule: raw colors are only allowed inside packages/client/src/theme/.
 *  Everywhere else, colors must come from `var(--pf-*)` tokens. */
export default {
  extends: ["stylelint-config-standard"],
  rules: {
    "custom-property-pattern": "^pf-[a-z0-9-]+$",
    // CSS modules classes are camelCase so they read naturally from TSX.
    "selector-class-pattern": "^[a-z][a-zA-Z0-9]*$",
    // CSS modules: :global(.pfHook) reaches the theme skin's hook classes.
    "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: ["global"] }],
  },
  overrides: [
    {
      files: ["packages/client/src/!(theme)/**/*.css"],
      rules: {
        "color-no-hex": true,
        // Raw color construction is banned; color-mix stays legal because its
        // inputs must themselves be tokens under the rules below.
        "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla", "oklch"],
        "declaration-property-value-disallowed-list": {
          "/^(color|background|background-color|border|border-color|outline|outline-color|fill|stroke|box-shadow)$/":
            // currentcolor in either case: stylelint-config-standard's
            // value-keyword-case demands the lowercase spelling.
            [/^(?!.*var\(--pf-)(?!.*(?:inherit|transparent|[cC]urrent[cC]olor|none|initial|unset)|0$).*$/],
        },
      },
    },
  ],
};
