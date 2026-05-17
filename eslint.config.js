import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["packages/**/*.ts", "shared/**/*.ts"],
    rules: {
      // Allow unused vars prefixed with _ (common pattern for intentional skips)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Prefer explicit function return types on exports
      "@typescript-eslint/explicit-function-declaration-return-type": "off",
      // Allow non-null assertions where checked contextually
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "dotfiles/",
      "*.config.js",
      "*.config.ts",
    ],
  },
);
