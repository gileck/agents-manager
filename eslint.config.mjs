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
  },
  // Architectural boundary: CLI must not import from src/core/
  {
    files: ["src/cli/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/core/**", "../core/**", "../../core/**"], message: "CLI must use the daemon API client (src/client/), not core services directly." },
          ],
        },
      ],
    },
  },
  // Architectural boundary: Electron IPC handlers must not import from src/core/
  {
    files: ["src/main/ipc-handlers/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/core/**", "../core/**", "../../core/**"], message: "IPC handlers must use the daemon API client (src/client/), not core services directly." },
          ],
        },
      ],
    },
  }
);
