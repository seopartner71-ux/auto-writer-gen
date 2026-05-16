import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Pages should not import from other pages — extract shared code into
      // components/, features/, or shared/ instead. Prevents tight coupling
      // between routes and accidental circular deps.
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["@/pages/*", "../pages/*", "../../pages/*"],
              message:
                "Do not import from src/pages/* — extract shared code into src/components, src/features, or src/shared.",
            },
          ],
        },
      ],
    },
  },
  {
    // Allow App.tsx to import page components (routing entrypoint).
    files: ["src/App.tsx", "src/main.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
);
