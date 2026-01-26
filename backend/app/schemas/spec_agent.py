from typing import List, Dict, Any, Optional, Union, Literal
from pydantic import BaseModel, Field

class SpecNodeBase(BaseModel):
    """
    Spec DAG 中所有节点的基类。
    """
    id: str = Field(..., description="节点的唯一标识符")
    type: str = Field(..., description="节点类型")
    desc: Optional[str] = Field(None, description="节点描述，用于 UI 展示")
    needs: List[str] = Field(default_factory=list, description="依赖的前置节点 ID 列表")

class ActionNode(SpecNodeBase):
    """
    执行节点：通用任务执行者。
    """
    type: Literal["action"] = "action"
    
    # 核心字段变更为 instruction
    instruction: str = Field(..., description="给 Sub-Agent 的具体自然语言指令 (e.g. 'Search for RTX 4090 price')")
    
    # 辅助字段
    required_tools: List[str] = Field(default_factory=list, description="建议使用的工具列表 (e.g. ['mcp.search.tavily'])")
    
    # 兼容旧逻辑 (可选)
    worker: str = Field("generic", description="执行者身份 (默认为通用 generic)")
    args: Dict[str, Any] = Field(default_factory=dict, description="结构化参数 (如果 Planner 确定了参数)")
    
    output_as: Optional[str] = Field(None, description="输出变量名，供后续节点引用")
    check_in: bool = Field(False, description="是否需要用户审批 (策略熔断点)")
    model_override: Optional[str] = Field(
        None, description="节点级模型覆盖 (优先于全局/默认模型)"
    )

class LogicRule(BaseModel):
    """
    逻辑网关的判断规则。
    """
    condition: str = Field(..., description="判断条件表达式 (e.g., '$.has_32G_stock == true')")
    next_node: str = Field(..., description="条件满足时跳转的节点 ID")
    desc: Optional[str] = Field(None, description="规则描述")

class LogicGateNode(SpecNodeBase):
    """
    逻辑网关节点：基于输入数据决定后续路径。
    """
    type: Literal["logic_gate"] = "logic_gate"
    input: str = Field(..., description="输入数据的引用 (e.g., '{{stock_status}}')")
    rules: List[LogicRule] = Field(..., description="判断规则列表")
    default: str = Field(..., description="默认跳转的节点 ID (当所有规则都不满足时)")

class ReplanTriggerNode(SpecNodeBase):
    """
    重规划触发节点：当遇到不可预见情况时，触发 Foreman 重新规划。
    """
    type: Literal["replan_trigger"] = "replan_trigger"
    reason: str = Field(..., description="触发重规划的原因")
    new_goal: Optional[str] = Field(None, description="重规划的新目标 (可选)")

# 使用 Union 类型以便在列表中多态解析
SpecNode = Union[ActionNode, LogicGateNode, ReplanTriggerNode]

class SpecManifest(BaseModel):
    """
    Spec Agent 施工蓝图 (v1.2)
    """
    spec_v: str = Field("1.2", description="Spec 协议版本")
    project_name: str = Field(..., description="项目/任务名称")
    nodes: List[SpecNode] = Field(..., description="DAG 节点列表")
    
    context: Dict[str, Any] = Field(default_factory=dict, description="全局上下文变量")
