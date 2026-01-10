/**
 * 简单的复制功能测试
 * 可以在浏览器控制台中运行
 */

export function testClipboard() {
  const testText = "测试复制功能 - Test Copy Function - 123456";
  
  console.log("开始测试复制功能...");
  
  // 测试现代 API
  if (navigator?.clipboard) {
    navigator.clipboard.writeText(testText)
      .then(() => {
        console.log("✅ Clipboard API 复制成功");
      })
      .catch((error) => {
        console.log("❌ Clipboard API 复制失败:", error);
        testExecCommand();
      });
  } else {
    console.log("⚠️ Clipboard API 不可用，尝试 execCommand");
    testExecCommand();
  }
  
  function testExecCommand() {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = testText;
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.width = '2em';
      textArea.style.height = '2em';
      textArea.style.padding = '0';
      textArea.style.border = 'none';
      textArea.style.outline = 'none';
      textArea.style.boxShadow = 'none';
      textArea.style.background = 'transparent';
      textArea.style.opacity = '0';
      
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        console.log("✅ execCommand 复制成功");
      } else {
        console.log("❌ execCommand 复制失败");
      }
    } catch (error) {
      console.log("❌ execCommand 出现异常:", error);
    }
  }
}

// 在控制台中运行: testClipboard()
if (typeof window !== 'undefined') {
  (window as any).testClipboard = testClipboard;
}