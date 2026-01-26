import os
import sys
import json
import re
import requests
from typing import Dict, Any

# 将 backend 目录加入路径，以便导入 app 模块
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

# 加载 .env 文件
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    load_dotenv(env_path)
    print(f"✅ 已加载环境变量文件: {env_path}")
except ImportError:
    print("⚠️  未安装 python-dotenv，将直接使用系统环境变量")

try:
    from openai import OpenAI
    from app.schemas.spec_agent import SpecManifest
    from app.prompts.spec_planner import SPEC_PLANNER_SYSTEM_PROMPT
except ImportError as e:
    print(f"导入错误: {e}")
    print("请确保您在 /data/AI-Higress-Gateway/backend 目录下，并且已安装 openai 和 pydantic")
    sys.exit(1)

# ==========================================
# 配置区域
# ==========================================
# 1. LLM 配置
API_KEY = os.environ.get("TEST_API_KEY", "sk-placeholder")
BASE_URL = os.environ.get("TEST_LLM_BASE_URL", "https://api.openai.com/v1")
MODEL_NAME = os.environ.get("TEST_LLM_MODEL", "gpt-4o")

if BASE_URL and not BASE_URL.endswith('/v1') and not BASE_URL.endswith('/v1/'):
    BASE_URL = BASE_URL.rstrip('/') + '/v1'

# 2. Tavily 配置 (用于真实执行)
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")

# ==========================================
# 工具定义 (模拟 MCP Discovery)
# ==========================================
AVAILABLE_TOOLS = [
    {
        "name": "mcp.search.tavily",
        "description": "联网搜索工具。用于获取实时的网页信息、新闻、价格、评测等。支持查询复杂问题。",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词或问题"},
                "days": {"type": "integer", "description": "搜索最近几天的信息 (可选)", "default": 3},
                "include_domains": {"type": "array", "items": {"type": "string"}, "description": "限定搜索域名列表 (可选)"}
            },
            "required": ["query"]
        }
    },
    {
        "name": "mcp.calculator.evaluate",
        "description": "高级计算器与比价工具。用于计算总价、对比差价、评估性价比。",
        "input_schema": {
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "数学表达式 (e.g. '6999 + 400')"},
                "items": {"type": "array", "description": "待比价的商品列表"}
            }
        }
    }
]

# 将工具列表格式化为字符串，注入 Prompt
TOOLS_DESC_STR = "\n".join([
    f"- Tool: {t['name']}\n  Desc: {t['description']}\n  Schema: {json.dumps(t['input_schema'], ensure_ascii=False)}"
    for t in AVAILABLE_TOOLS
])

# ==========================================
# 1. Planner: 调用大模型生成施工蓝图
# ==========================================
def generate_spec_plan(user_query: str) -> SpecManifest:
    print(f"\n🧠 [Planner] 正在思考: '{user_query.strip()}' ...")

    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
    
    # 动态注入工具列表
    system_prompt = SPEC_PLANNER_SYSTEM_PROMPT.replace("{{available_tools}}", TOOLS_DESC_STR)

    try:
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_query}
            ],
            response_format={"type": "json_object"}, 
            temperature=0.7
        )

        content = response.choices[0].message.content
        print(f"📜 [Planner] 生成原始 JSON:\n{content[:500]}...\n")

        spec_data = json.loads(content)
        manifest = SpecManifest(**spec_data)
        print(f"✅ [Parser] Spec 校验通过! 项目名: {manifest.project_name}, 节点数: {len(manifest.nodes)}")
        return manifest

    except Exception as e:
        print(f"❌ [Planner] 生成失败: {e}")
        return mock_manifest()

def mock_manifest():
    return SpecManifest(
        spec_v="1.2",
        project_name="Mock_Fallback_Plan",
        nodes=[
            {
                "id": "T1_Search",
                "type": "action",
                "worker": "mcp.search.tavily", # 使用真实工具名
                "desc": "搜索 RTX 4090 价格",
                "args": {"query": "RTX 4090 price amazon"},
                "output_as": "search_res",
                "needs": []
            }
        ]
    )

# ==========================================
# 2. Executor: 真实调度引擎
# ==========================================
class SimpleExecutor:
    def __init__(self, manifest: SpecManifest):
        self.manifest = manifest
        self.context: Dict[str, Any] = {}
        self.completed_nodes = set()
        self.skipped_nodes = set()
        self.node_map = {n.id: n for n in self.manifest.nodes}
        self.dag_children = {n.id: [] for n in self.manifest.nodes}
        for n in self.manifest.nodes:
            for dep in n.needs:
                if dep in self.dag_children:
                    self.dag_children[dep].append(n.id)

    def run(self):
        print(f"\n🚀 [Executor] 开始执行项目: {self.manifest.project_name}")
        
        while len(self.completed_nodes) + len(self.skipped_nodes) < len(self.manifest.nodes):
            executable_nodes = []
            for node in self.manifest.nodes:
                if node.id in self.completed_nodes or node.id in self.skipped_nodes:
                    continue
                
                deps_satisfied = True
                for dep in node.needs:
                    if dep in self.skipped_nodes:
                        self.skip_subtree(node.id)
                        deps_satisfied = False
                        break
                    if dep not in self.completed_nodes:
                        deps_satisfied = False
                        break
                
                if deps_satisfied:
                    executable_nodes.append(node)
            
            if not executable_nodes:
                break

            for node in executable_nodes:
                if node.id not in self.skipped_nodes:
                    self.execute_node(node)

    def execute_node(self, node):
        print(f"  ▶️  正在执行: [{node.id}] {node.desc or ''}")
        
        # --- A. 动作节点 ---
        if node.type == "action":
            # ... (action handling remains the same)
            # 策略熔断
            if hasattr(node, "check_in") and node.check_in:
                user_input = input(f"  🛑 [Check-in] 节点 '{node.id}' 请求审批。是否继续? (y/n): ")
                if user_input.lower() != 'y':
                    print("  🚫 用户取消执行。流程终止。")
                    sys.exit(0)
                print("  ✅ 用户已批准。")

            # 参数解析
            resolved_args = {}
            for k, v in node.args.items():
                if isinstance(v, str) and "{{" in v:
                    resolved_args[k] = self.resolve_variable(v)
                else:
                    resolved_args[k] = v
            
            # === 真实工具路由 ===
            if node.worker == "mcp.search.tavily":
                result = self.call_real_tavily(resolved_args)
            else:
                result = self.mock_worker_call(node.worker, resolved_args)
            
            if node.output_as:
                self.context[node.output_as] = result
                # 打印部分结果以示证明
                res_str = str(result)
                print(f"     📦 输出变量 '{node.output_as}': {res_str[:100]}..." if len(res_str) > 100 else f"     📦 输出变量 '{node.output_as}': {res_str}")
            
            self.completed_nodes.add(node.id)

        # --- B. 逻辑网关 ---
        elif node.type == "logic_gate":
            input_val = self.resolve_variable(node.input)
            print(f"     🔍 网关判断输入: {str(input_val)[:50]}...")
            
            next_step = node.default
            matched_desc = "默认路径"
            
            for rule in node.rules:
                try:
                    condition = rule.condition.replace("$.", "")
                    # 增强判断逻辑: 支持 >, <, >=, <=, ==
                    ops = {">=": lambda x, y: x >= y, "<=": lambda x, y: x <= y, ">": lambda x, y: x > y, "<": lambda x, y: x < y, "==": lambda x, y: x == y}
                    
                    matched_op = None
                    for op_symbol in ops.keys():
                        if op_symbol in condition:
                            matched_op = op_symbol
                            break
                    
                    if matched_op:
                        key, expected_val = [x.strip() for x in condition.split(matched_op)]
                        actual_val = input_val.get(key) if isinstance(input_val, dict) else input_val
                        
                        # 尝试转换为数字比较
                        try:
                            actual_num = float(actual_val)
                            expected_num = float(expected_val)
                            if ops[matched_op](actual_num, expected_num):
                                next_step = rule.next_node
                                matched_desc = rule.desc
                                break
                        except ValueError:
                            # 字符串比较 (仅支持 ==)
                            if matched_op == "==" and str(actual_val).lower() == str(expected_val).lower().replace("'", "").replace('"', ""):
                                next_step = rule.next_node
                                matched_desc = rule.desc
                                break
                except Exception as e:
                    print(f"     ⚠️  规则解析异常: {e}")

            print(f"     🎯 匹配结果: {matched_desc} -> {next_step}")
            
            children = self.dag_children.get(node.id, [])
            for child_id in children:
                if child_id != next_step:
                    print(f"     ✂️  剪枝分支: {child_id}")
                    self.skip_subtree(child_id)
            
            self.completed_nodes.add(node.id)

    def call_real_tavily(self, args: Dict[str, Any]) -> Any:
        """调用真实的 Tavily API"""
        query = args.get("query")
        if not TAVILY_API_KEY:
            print("     ⚠️  未配置 TAVILY_API_KEY，返回模拟数据")
            return {"results": [{"title": "Mock Search Result", "content": "Tavily API Key missing."}], "has_stock": False}
        
        print(f"     🌍 发起真实网络搜索: '{query}'")
        try:
            resp = requests.post(
                "https://api.tavily.com/search",
                json={"query": query, "api_key": TAVILY_API_KEY, "include_answer": True},
                timeout=10
            )
            data = resp.json()
            summary = data.get("answer", "")
            results = data.get("results", [])
            
            # === 数据契约修复: 智能提取 min_price ===
            extracted_price = 0
            # 匹配 "19857元" 或 "￥19857" 或 "$3000"
            price_patterns = [
                r'(\d{1,3}(?:,\d{3})*|\d+)\s*元',
                r'￥\s*(\d{1,3}(?:,\d{3})*|\d+)',
                r'\$\s*(\d{1,3}(?:,\d{3})*|\d+)'
            ]
            
            for pattern in price_patterns:
                matches = re.findall(pattern, summary)
                if matches:
                    # 取最后一个匹配到的数字作为参考（通常 summary 会总结最终价格）
                    # 移除逗号
                    try:
                        extracted_price = float(matches[-1].replace(",", ""))
                        print(f"     💰 从摘要中提取到价格: {extracted_price}")
                        break
                    except:
                        continue
            
            if extracted_price == 0:
                 # 如果摘要里没提取到，尝试从 results 标题里提取
                 for res in results[:3]:
                     for pattern in price_patterns:
                        match = re.search(pattern, res.get("content", "") + res.get("title", ""))
                        if match:
                            try:
                                extracted_price = float(match.group(1).replace(",", ""))
                                print(f"     💰 从结果中提取到价格: {extracted_price}")
                                break
                            except:
                                continue
                     if extracted_price > 0: break

            return {
                "summary": summary, 
                "results": results[:2],
                "min_price": extracted_price, # 填充关键字段
                "price": extracted_price,     # 兼容字段
                "has_stock": "out of stock" not in summary.lower()
            }
        except Exception as e:
            print(f"     ❌ Tavily 调用失败: {e}")
            return {"error": str(e)}

    def mock_worker_call(self, worker: str, args: Dict[str, Any] = None) -> Any:
        print(f"     🔧 调用 Worker (Mock): {worker}")
        if args is None:
            args = {}
        return {"status": "ok", "mock_data": True}

    def skip_subtree(self, node_id):
        if node_id in self.skipped_nodes:
            return
        self.skipped_nodes.add(node_id)
        for child in self.dag_children.get(node_id, []):
            self.skip_subtree(child)

    def resolve_variable(self, var_str: str) -> Any:
        if not (isinstance(var_str, str) and var_str.startswith("{{") and var_str.endswith("}}")):
            return var_str
        expr = var_str[2:-2].strip()
        parts = expr.split('.')
        val = self.context.get(parts[0])
        if val is None: return None
        current = val
        for part in parts[1:]:
            if isinstance(current, dict):
                current = current.get(part)
            else:
                return None
        return current

def main():
    print("=" * 60)
    print("🎯 Spec Agent 真实搜索测试")
    print("=" * 60)
    
    # 一个需要联网才能回答的问题
    user_query = """
    帮我查一下 RTX 5090 现在的价格是多少？
    如果超过 15000 元，就帮我查查 RTX 4090D 的价格。
    """

    manifest = generate_spec_plan(user_query)
    
    if manifest:
        executor = SimpleExecutor(manifest)
        executor.run()

if __name__ == "__main__":
    main()
