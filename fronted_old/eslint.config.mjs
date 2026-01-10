import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import customRules from "./eslint-rules/index.js";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "eslint-rules/**", // 排除自定义规则目录
  ]),
  {
    plugins: {
      "frontend-optimization": customRules,
    },
    rules: {
      // 自定义规则：检查客户端组件使用
      "frontend-optimization/check-client-components": "error",
      
      // 自定义规则：检查文件大小（限制 200 行）
      "frontend-optimization/check-file-size": ["error", { maxLines: 200 }],
      
      // 自定义规则：检查命名规范（kebab-case）
      "frontend-optimization/check-naming-convention": "error",
      
      // TypeScript 严格规则
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { 
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_" 
      }],
      
      // React 最佳实践
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      
      // 性能优化相关
      "react/jsx-no-bind": ["warn", {
        allowArrowFunctions: true,
        allowBind: false,
        ignoreRefs: true,
      }],
    },
  },
]);

export default eslintConfig;
