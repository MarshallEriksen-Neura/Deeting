/**
 * ESLint 自定义规则：检查文件大小
 * 
 * 规则：组件文件不应超过 200 行代码（不包括注释和空行）
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: '确保组件文件不超过 200 行代码',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      fileTooLarge: '组件文件超过 {{lines}} 行（限制：200 行）。请考虑拆分为更小的子组件。',
    },
    schema: [
      {
        type: 'object',
        properties: {
          maxLines: {
            type: 'integer',
            minimum: 1,
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const maxLines = options.maxLines || 200;
    const filename = context.getFilename();
    
    // 只检查组件文件
    const isComponentFile = 
      (filename.includes('/components/') || filename.includes('/app/')) &&
      (filename.endsWith('.tsx') || filename.endsWith('.ts')) &&
      !filename.endsWith('.test.tsx') &&
      !filename.endsWith('.test.ts');

    return {
      Program(node) {
        if (!isComponentFile) return;

        const sourceCode = context.getSourceCode();
        const lines = sourceCode.lines;
        
        // 计算非空行和非注释行
        let codeLines = 0;
        let inBlockComment = false;

        for (const line of lines) {
          const trimmed = line.trim();
          
          // 跳过空行
          if (trimmed === '') continue;
          
          // 处理块注释
          if (trimmed.startsWith('/*')) {
            inBlockComment = true;
          }
          if (inBlockComment) {
            if (trimmed.endsWith('*/')) {
              inBlockComment = false;
            }
            continue;
          }
          
          // 跳过单行注释
          if (trimmed.startsWith('//')) continue;
          
          codeLines++;
        }

        if (codeLines > maxLines) {
          context.report({
            node,
            messageId: 'fileTooLarge',
            data: {
              lines: codeLines,
            },
          });
        }
      },
    };
  },
};
