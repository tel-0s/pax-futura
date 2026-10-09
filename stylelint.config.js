/** Theming rule: raw colors are only allowed inside packages/client/src/theme/.
 *  Everywhere else, colors must come from `var(--pf-*)` tokens. */
export default {
  extends: ["stylelint-config-standard"],
  rules: {
    "custom-property-pattern": "^pf-[a-z0-9-]+$",
    // CSS modules classes are camelCase so they read naturally from TSX.
    "selector-class-pattern": "^[a-z][a-zA-Z0-9]*$",
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
            [/^(?!.*var\(--pf-)(?!.*(?:inherit|transparent|currentColor|none|initial|unset)|0$).*$/],
        },
      },
    },
  ],
};
