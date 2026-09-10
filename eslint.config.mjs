import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: projectDirectory });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".artifacts/**",
      ".superpowers/**",
      ".vercel/**",
      "node_modules/**",
      "services/orchestrator/dist/**",
      "services/orchestrator/node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "next-env.d.ts"
    ]
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }]
    }
  }
];

export default eslintConfig;
