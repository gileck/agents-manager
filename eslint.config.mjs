import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "dist/**",
      "dist-main/**",
      "dist-cli/**",
      "node_modules/**",
      ".agent-worktrees/**",
      "config/**",
    ],
  },
  {
    rules: {
      // TypeScript handles undefined-variable checks far better than ESLint
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "require-yield": "off",
    },
  }
);
