/**
 * 前端优化 ESLint 自定义规则集
 */

module.exports = {
  rules: {
    'check-client-components': require('./check-client-components'),
    'check-file-size': require('./check-file-size'),
    'check-naming-convention': require('./check-naming-convention'),
  },
};
