/**
 * ESLint 自定义规则：检查文件命名规范
 * 
 * 规则：组件文件应该使用 kebab-case 命名法
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: '确保组件文件使用 kebab-case 命名法',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      invalidNaming: '组件文件应该使用 kebab-case 命名法（如 user-profile-card.tsx），当前文件名：{{filename}}',
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();
    const basename = filename.split('/').pop();
    
    // 排除特殊文件
    const specialFiles = [
      'page.tsx', 'layout.tsx', 'loading.tsx', 'error.tsx', 
      'not-found.tsx', 'global-error.tsx', 'route.ts',
      'middleware.ts', 'instrumentation.ts'
    ];
    
    if (specialFiles.includes(basename)) return {};
    
    // 只检查组件文件
    const isComponentFile = 
      (filename.includes('/components/') || filename.includes('/app/')) &&
      (basename.endsWith('.tsx') || basename.endsWith('.ts')) &&
      !basename.endsWith('.test.tsx') &&
      !basename.endsWith('.test.ts') &&
      !basename.endsWith('.d.ts');

    return {
      Program(node) {
        if (!isComponentFile) return;

        const nameWithoutExt = basename.replace(/\.(tsx?|jsx?)$/, '');
        
        // 检查是否符合 kebab-case
        // kebab-case: 全小写，单词之间用连字符连接
        const kebabCaseRegex = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
        
        if (!kebabCaseRegex.test(nameWithoutExt)) {
          context.report({
            node,
            messageId: 'invalidNaming',
            data: {
              filename: basename,
            },
          });
        }
      },
    };
  },
};
