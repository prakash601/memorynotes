import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The domain layer must stay framework-free so it can be extracted into a
    // standalone service later (ADR-0005).
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next", message: "src/core must stay framework-free (ADR-0005)." },
            { name: "react", message: "src/core must stay framework-free (ADR-0005)." },
            { name: "react-dom", message: "src/core must stay framework-free (ADR-0005)." },
            { name: "server-only", message: "src/core must stay framework-free (ADR-0005)." },
          ],
          patterns: [
            {
              group: ["next/*", "react/*", "react-dom/*", "next-auth", "next-auth/*", "@auth/*"],
              message: "src/core must stay framework-free (ADR-0005).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "drizzle/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
