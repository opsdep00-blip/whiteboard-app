import nextLintConfig from "eslint-config-next";

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...nextLintConfig,
  {
    rules: {
      "react/jsx-props-no-spreading": "off"
    }
  }
];
