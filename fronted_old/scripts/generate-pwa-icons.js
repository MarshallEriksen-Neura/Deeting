#!/usr/bin/env node

/**
 * PWA 图标生成脚本
 *
 * 此脚本用于生成 AI Higress PWA 所需的图标文件
 * 需要安装 sharp: npm install sharp --save-dev
 *
 * 使用方法:
 * 1. 准备一个 512x512 的源图标文件 (icon-source.png)
 * 2. 运行: node scripts/generate-pwa-icons.js
 */

const fs = require('fs');
const path = require('path');

// 如果没有 sharp，显示安装说明
try {
  const sharp = require('sharp');
  console.log('✓ sharp 已安装，开始生成图标...');

  const sourceIcon = path.join(__dirname, '../public/icon-source.png');
  const publicDir = path.join(__dirname, '../public');

  // 检查源文件是否存在
  if (!fs.existsSync(sourceIcon)) {
    console.log('❌ 找不到源图标文件: public/icon-source.png');
    console.log('');
    console.log('请准备一个 512x512 的 PNG 图标文件并命名为 icon-source.png 放在 public 目录下');
    console.log('');
    console.log('图标设计要求:');
    console.log('- 尺寸: 512x512px');
    console.log('- 格式: PNG (透明背景)');
    console.log('- 设计风格: 简洁的路由/网关图标，符合墨水风格');
    console.log('- 主色调: 深灰色 (#1a1a1a) 和纯白 (#ffffff)');
    console.log('- 强调色: 深蓝 (#0066cc)');
    process.exit(1);
  }

  // 生成不同尺寸的图标
  const sizes = [192, 512];

  console.log('正在生成图标...');

  sizes.forEach(async (size) => {
    const outputPath = path.join(publicDir, `icon-${size}x${size}.png`);

    try {
      await sharp(sourceIcon)
        .resize(size, size)
        .png()
        .toFile(outputPath);

      console.log(`✓ 生成 ${size}x${size} 图标: ${outputPath}`);
    } catch (error) {
      console.error(`❌ 生成 ${size}x${size} 图标失败:`, error.message);
    }
  });

  console.log('');
  console.log('图标生成完成！');
  console.log('');
  console.log('请确保以下文件存在于 public 目录:');
  console.log('- icon-192x192.png');
  console.log('- icon-512x512.png');
  console.log('- manifest.json (已创建)');

} catch (error) {
  console.log('❌ sharp 未安装');
  console.log('');
  console.log('请先安装 sharp:');
  console.log('npm install sharp --save-dev');
  console.log('');
  console.log('或者手动准备以下图标文件到 public 目录:');
  console.log('- icon-192x192.png (192x192px)');
  console.log('- icon-512x512.png (512x512px)');
  console.log('');
  console.log('图标设计要求:');
  console.log('- 格式: PNG (透明背景)');
  console.log('- 设计风格: 简洁的路由/网关图标，符合墨水风格');
  console.log('- 主色调: 深灰色 (#1a1a1a) 和纯白 (#ffffff)');
  console.log('- 强调色: 深蓝 (#0066cc)');
  process.exit(1);
}

// 验证 manifest.json
const manifestPath = path.join(__dirname, '../public/manifest.json');
if (fs.existsSync(manifestPath)) {
  console.log('✓ manifest.json 已存在');
} else {
  console.log('❌ manifest.json 不存在，请检查');
}