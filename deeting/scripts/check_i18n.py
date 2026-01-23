#!/usr/bin/env python3
"""
国际化实现检查脚本
检查所有组件是否正确使用 useI18n Hook 和是否有硬编码字符串
"""

import os
import re
import json
from pathlib import Path
from typing import Dict, List, Set, Tuple

# 定义要检查的目录
DIRS_TO_CHECK = [
    "components/chat",
    "components/image",
    "components/common",
]

# 国际化文件目录
I18N_DIR = "messages"

def find_tsx_files(base_dir: str) -> List[str]:
    """查找所有 .tsx 文件"""
    tsx_files = []
    for root, dirs, files in os.walk(base_dir):
        # 跳过 node_modules
        if 'node_modules' in root:
            continue
        for file in files:
            if file.endswith('.tsx'):
                tsx_files.append(os.path.join(root, file))
    return sorted(tsx_files)

def check_use_i18n(file_path: str) -> bool:
    """检查文件是否使用了 useI18n 或 useTranslations"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            return 'useI18n' in content or 'useTranslations' in content
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return False

def find_chinese_strings(file_path: str) -> List[Tuple[int, str]]:
    """查找文件中的中文字符串（排除注释）"""
    chinese_strings = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            in_multiline_comment = False
            
            for i, line in enumerate(lines, 1):
                # 跳过多行注释
                if '/*' in line:
                    in_multiline_comment = True
                if '*/' in line:
                    in_multiline_comment = False
                    continue
                if in_multiline_comment:
                    continue
                
                # 跳过单行注释
                if line.strip().startswith('//'):
                    continue
                
                # 查找中文字符
                if re.search(r'[\u4e00-\u9fa5]', line):
                    # 排除注释中的中文
                    code_part = line.split('//')[0]
                    if re.search(r'[\u4e00-\u9fa5]', code_part):
                        chinese_strings.append((i, line.strip()))
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
    
    return chinese_strings

def find_hardcoded_english(file_path: str) -> List[Tuple[int, str]]:
    """查找 JSX 中可能的硬编码英文字符串"""
    hardcoded_strings = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            
            for i, line in enumerate(lines, 1):
                # 跳过注释
                if line.strip().startswith('//') or line.strip().startswith('*'):
                    continue
                
                # 查找 JSX 中的文本内容 >text<
                # 排除常见的技术术语和组件名
                matches = re.findall(r'>([A-Z][a-zA-Z\s]+)<', line)
                for match in matches:
                    # 排除单个大写字母、组件名等
                    if len(match) > 2 and not match.isupper():
                        # 排除常见的技术术语
                        if match not in ['Button', 'Input', 'Card', 'Dialog', 'Select', 'Table']:
                            hardcoded_strings.append((i, line.strip()))
                            break
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
    
    return hardcoded_strings

def load_i18n_keys(locale: str) -> Set[str]:
    """加载指定语言的所有 i18n keys"""
    keys = set()
    i18n_path = Path(I18N_DIR) / locale
    
    if not i18n_path.exists():
        return keys
    
    for json_file in i18n_path.glob('*.json'):
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # 递归提取所有 keys
                def extract_keys(obj, prefix=''):
                    if isinstance(obj, dict):
                        for key, value in obj.items():
                            new_prefix = f"{prefix}.{key}" if prefix else key
                            if isinstance(value, dict):
                                extract_keys(value, new_prefix)
                            else:
                                keys.add(new_prefix)
                
                extract_keys(data)
        except Exception as e:
            print(f"Error loading {json_file}: {e}")
    
    return keys

def compare_i18n_completeness(zh_keys: Set[str], en_keys: Set[str]) -> Dict[str, List[str]]:
    """比较中英文 i18n keys 的完整性"""
    return {
        'missing_in_en': sorted(list(zh_keys - en_keys)),
        'missing_in_zh': sorted(list(en_keys - zh_keys)),
        'common': sorted(list(zh_keys & en_keys))
    }

def generate_report():
    """生成完整的检查报告"""
    print("=" * 80)
    print("国际化实现检查报告")
    print("=" * 80)
    print()
    
    total_files = 0
    total_with_i18n = 0
    total_without_i18n = 0
    files_with_chinese = []
    files_with_hardcoded_english = []
    
    # 1. 检查每个目录
    for dir_name in DIRS_TO_CHECK:
        print(f"\n{'=' * 80}")
        print(f"检查目录: {dir_name}")
        print(f"{'=' * 80}\n")
        
        tsx_files = find_tsx_files(dir_name)
        files_with_i18n = []
        files_without_i18n = []
        
        for file_path in tsx_files:
            total_files += 1
            if check_use_i18n(file_path):
                files_with_i18n.append(file_path)
                total_with_i18n += 1
            else:
                files_without_i18n.append(file_path)
                total_without_i18n += 1
        
        print(f"📊 统计信息:")
        print(f"  - 总组件文件数: {len(tsx_files)}")
        print(f"  - 使用 useI18n 的文件数: {len(files_with_i18n)}")
        print(f"  - 未使用 useI18n 的文件数: {len(files_without_i18n)}")
        if len(tsx_files) > 0:
            print(f"  - 使用率: {len(files_with_i18n) / len(tsx_files) * 100:.1f}%")
        else:
            print(f"  - 使用率: N/A (无文件)")
        
        if files_with_i18n:
            print(f"\n✅ 使用 useI18n 的文件:")
            for file_path in files_with_i18n:
                print(f"  - {file_path}")
        
        if files_without_i18n:
            print(f"\n⚠️  未使用 useI18n 的文件:")
            for file_path in files_without_i18n:
                print(f"  - {file_path}")
                
                # 检查这些文件是否有硬编码字符串
                chinese = find_chinese_strings(file_path)
                if chinese:
                    files_with_chinese.append((file_path, chinese))
                
                english = find_hardcoded_english(file_path)
                if english:
                    files_with_hardcoded_english.append((file_path, english))
    
    # 2. 硬编码字符串检查
    print(f"\n\n{'=' * 80}")
    print("硬编码字符串检查")
    print(f"{'=' * 80}\n")
    
    if files_with_chinese:
        print(f"🔴 发现包含中文字符的文件 ({len(files_with_chinese)} 个):\n")
        for file_path, chinese_strings in files_with_chinese:
            print(f"  📄 {file_path}")
            for line_num, line in chinese_strings[:5]:  # 只显示前5个
                print(f"     L{line_num}: {line[:100]}")
            if len(chinese_strings) > 5:
                print(f"     ... 还有 {len(chinese_strings) - 5} 处")
            print()
    else:
        print("✅ 未发现包含中文字符的代码（注释除外）\n")
    
    if files_with_hardcoded_english:
        print(f"⚠️  可能包含硬编码英文的文件 ({len(files_with_hardcoded_english)} 个):\n")
        for file_path, english_strings in files_with_hardcoded_english:
            print(f"  📄 {file_path}")
            for line_num, line in english_strings[:3]:  # 只显示前3个
                print(f"     L{line_num}: {line[:100]}")
            if len(english_strings) > 3:
                print(f"     ... 还有 {len(english_strings) - 3} 处")
            print()
    
    # 3. i18n 文件完整性检查
    print(f"\n{'=' * 80}")
    print("i18n 文件完整性检查")
    print(f"{'=' * 80}\n")
    
    zh_keys = load_i18n_keys('zh-CN')
    en_keys = load_i18n_keys('en')
    
    print(f"📊 i18n Keys 统计:")
    print(f"  - 中文 keys 数量: {len(zh_keys)}")
    print(f"  - 英文 keys 数量: {len(en_keys)}")
    
    comparison = compare_i18n_completeness(zh_keys, en_keys)
    
    if comparison['missing_in_en']:
        print(f"\n⚠️  英文翻译缺失的 keys ({len(comparison['missing_in_en'])} 个):")
        for key in comparison['missing_in_en'][:10]:
            print(f"  - {key}")
        if len(comparison['missing_in_en']) > 10:
            print(f"  ... 还有 {len(comparison['missing_in_en']) - 10} 个")
    
    if comparison['missing_in_zh']:
        print(f"\n⚠️  中文翻译缺失的 keys ({len(comparison['missing_in_zh'])} 个):")
        for key in comparison['missing_in_zh'][:10]:
            print(f"  - {key}")
        if len(comparison['missing_in_zh']) > 10:
            print(f"  ... 还有 {len(comparison['missing_in_zh']) - 10} 个")
    
    if not comparison['missing_in_en'] and not comparison['missing_in_zh']:
        print("\n✅ 中英文翻译完整，无缺失")
    
    # 4. 总结
    print(f"\n\n{'=' * 80}")
    print("检查总结")
    print(f"{'=' * 80}\n")
    
    print(f"📊 整体统计:")
    print(f"  - 检查的组件总数: {total_files}")
    if total_files > 0:
        print(f"  - 使用 useI18n 的组件: {total_with_i18n} ({total_with_i18n / total_files * 100:.1f}%)")
        print(f"  - 未使用 useI18n 的组件: {total_without_i18n} ({total_without_i18n / total_files * 100:.1f}%)")
    else:
        print(f"  - 使用 useI18n 的组件: {total_with_i18n}")
        print(f"  - 未使用 useI18n 的组件: {total_without_i18n}")
    print(f"  - 包含中文字符的文件: {len(files_with_chinese)}")
    print(f"  - 可能包含硬编码英文的文件: {len(files_with_hardcoded_english)}")
    
    print(f"\n🎯 建议:")
    if total_without_i18n > 0:
        print(f"  1. 为 {total_without_i18n} 个未使用 useI18n 的组件添加国际化支持")
    if files_with_chinese:
        print(f"  2. 将 {len(files_with_chinese)} 个文件中的中文字符串移至 i18n 文件")
    if files_with_hardcoded_english:
        print(f"  3. 检查 {len(files_with_hardcoded_english)} 个文件中的英文字符串是否需要国际化")
    if comparison['missing_in_en'] or comparison['missing_in_zh']:
        print(f"  4. 补充缺失的翻译 keys")
    
    if total_with_i18n == total_files and not files_with_chinese and not comparison['missing_in_en'] and not comparison['missing_in_zh']:
        print("  ✅ 所有检查项均通过！国际化实现完整。")
    
    print(f"\n{'=' * 80}")

if __name__ == "__main__":
    generate_report()
