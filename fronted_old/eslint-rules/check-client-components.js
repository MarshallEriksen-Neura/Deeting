/**
 * ESLint 自定义规则：检查客户端组件使用
 * 
 * 规则：
 * 1. page.tsx 文件不应该包含 "use client" 声明
 * 2. 客户端组件应该放在 components 目录中
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: '确保 page.tsx 文件使用服务端组件，客户端组件放在 components 目录',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      pageWithUseClient: 'page.tsx 文件不应该使用 "use client"。请将交互逻辑拆分到独立的客户端组件中。',
      clientComponentInPage: '客户端组件应该放在 components 目录中，而不是直接作为 page.tsx',
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();
    const isPageFile = filename.endsWith('page.tsx') || filename.endsWith('page.ts');
    
    return {
      Program(node) {
        if (!isPageFile) return;

        const sourceCode = context.getSourceCode();
        const text = sourceCode.getText();

        // 检查是否包含 "use client" 声明
        if (text.includes('"use client"') || text.includes("'use client'")) {
          context.report({
            node,
            messageId: 'pageWithUseClient',
          });
        }
      },
    };
  },
};
