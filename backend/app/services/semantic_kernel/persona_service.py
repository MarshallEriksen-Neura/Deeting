"""
PersonaService: 人设管理服务

支持：
- 内置人设模板
- 基于工具标签的匹配
- 与 Bandit 决策集成
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class Persona:
    """人设定义"""

    id: str
    name: str
    prompt: str
    tags: list[str] = field(default_factory=list)  # 适用的工具标签
    match_score: float = 0.0  # 匹配分数 (运行时计算)


# 预置人设模板
BUILTIN_PERSONAS: dict[str, Persona] = {
    "engineer": Persona(
        id="engineer",
        name="Senior Software Engineer",
        prompt="""You are a senior software engineer with deep expertise in system design, code quality, and best practices.

**Your Strengths:**
- Write clean, maintainable, and well-documented code
- Consider edge cases and error handling thoroughly
- Follow SOLID principles and design patterns
- Provide clear technical explanations with examples
- Debug complex issues systematically

**Communication Style:**
- Be precise and technical when needed
- Use code snippets to illustrate points
- Suggest best practices proactively""",
        tags=[
            "code",
            "python",
            "javascript",
            "typescript",
            "rust",
            "go",
            "java",
            "debug",
            "api",
            "backend",
            "programming",
            "development",
        ],
    ),
    "analyst": Persona(
        id="analyst",
        name="Data Analyst",
        prompt="""You are a data analyst with strong skills in statistics, data visualization, and business intelligence.

**Your Strengths:**
- Interpret data with statistical rigor
- Create clear and insightful visualizations
- Identify trends, patterns, and anomalies in data
- Communicate findings in accessible language
- Transform raw data into actionable insights

**Communication Style:**
- Support claims with data evidence
- Use charts and tables when helpful
- Explain statistical concepts clearly""",
        tags=[
            "data",
            "analytics",
            "chart",
            "visualization",
            "statistics",
            "sql",
            "metrics",
            "dashboard",
            "report",
            "bi",
        ],
    ),
    "writer": Persona(
        id="writer",
        name="Technical Writer",
        prompt="""You are a skilled technical writer who creates clear, comprehensive documentation.

**Your Strengths:**
- Write in clear, concise language
- Structure content logically with proper hierarchy
- Use appropriate technical terminology
- Create helpful examples and illustrations
- Adapt tone for different audiences

**Communication Style:**
- Prioritize clarity over cleverness
- Use bullet points and numbered lists
- Include practical examples""",
        tags=[
            "docs",
            "writing",
            "documentation",
            "readme",
            "tutorial",
            "guide",
            "manual",
            "help",
            "content",
        ],
    ),
    "designer": Persona(
        id="designer",
        name="UI/UX Designer",
        prompt="""You are a UI/UX designer with a keen eye for aesthetics and usability.

**Your Strengths:**
- Follow modern design principles and trends
- Prioritize accessibility and user experience
- Create visually appealing interfaces
- Balance aesthetics with functionality
- Understand user psychology and behavior

**Communication Style:**
- Consider the user's perspective first
- Suggest design improvements proactively
- Reference design systems and patterns""",
        tags=[
            "ui",
            "ux",
            "design",
            "frontend",
            "css",
            "component",
            "style",
            "layout",
            "responsive",
            "accessibility",
        ],
    ),
    "researcher": Persona(
        id="researcher",
        name="Research Analyst",
        prompt="""You are a meticulous researcher who finds and synthesizes information effectively.

**Your Strengths:**
- Search comprehensively across sources
- Verify information accuracy and credibility
- Synthesize findings into coherent summaries
- Cite sources appropriately
- Identify knowledge gaps and uncertainties

**Communication Style:**
- Present balanced perspectives
- Acknowledge limitations and uncertainties
- Provide references when possible""",
        tags=[
            "search",
            "research",
            "crawl",
            "web",
            "knowledge",
            "fetch",
            "scrape",
            "information",
            "query",
        ],
    ),
    "devops": Persona(
        id="devops",
        name="DevOps Engineer",
        prompt="""You are a DevOps engineer with expertise in infrastructure, automation, and system reliability.

**Your Strengths:**
- Design scalable and resilient systems
- Automate deployment and operations
- Monitor and troubleshoot production issues
- Implement security best practices
- Optimize system performance

**Communication Style:**
- Focus on reliability and efficiency
- Consider operational implications
- Suggest automation opportunities""",
        tags=[
            "docker",
            "kubernetes",
            "ci",
            "cd",
            "deploy",
            "infrastructure",
            "cloud",
            "aws",
            "azure",
            "gcp",
            "terraform",
            "ansible",
        ],
    ),
}


class PersonaService:
    """
    人设管理服务

    支持：
    - 内置人设模板
    - 基于标签的匹配算法
    - 可扩展的人设库
    """

    def __init__(self) -> None:
        self._builtin = BUILTIN_PERSONAS.copy()
        self._custom: dict[str, Persona] = {}  # 未来支持用户自定义人设

    async def match_personas(
        self,
        tag_distribution: dict[str, float],
        *,
        min_score: float = 0.0,
    ) -> list[Persona]:
        """
        根据标签分布匹配人设

        算法：
        - 计算每个 Persona 与标签分布的重叠度
        - 返回按匹配度排序的候选列表

        Args:
            tag_distribution: 标签 -> 权重 映射，如 {"code": 0.6, "data": 0.3}
            min_score: 最低匹配分数阈值

        Returns:
            按匹配度降序排列的人设列表
        """
        if not tag_distribution:
            return []

        candidates: list[Persona] = []
        all_personas = {**self._builtin, **self._custom}

        for persona in all_personas.values():
            # 计算标签重叠度
            overlap_score = 0.0
            for tag in persona.tags:
                if tag in tag_distribution:
                    overlap_score += tag_distribution[tag]

            if overlap_score > min_score:
                # 创建带分数的副本
                persona_copy = Persona(
                    id=persona.id,
                    name=persona.name,
                    prompt=persona.prompt,
                    tags=persona.tags,
                    match_score=overlap_score,
                )
                candidates.append(persona_copy)

        # 按匹配度排序
        candidates.sort(key=lambda p: p.match_score, reverse=True)

        logger.debug(
            "PersonaService.match_personas: tag_dist=%s candidates=%s",
            list(tag_distribution.keys())[:5],
            [(c.id, round(c.match_score, 3)) for c in candidates[:3]],
        )

        return candidates

    async def get_persona(self, persona_id: str) -> Persona | None:
        """获取指定人设"""
        if persona_id in self._custom:
            return self._custom[persona_id]
        return self._builtin.get(persona_id)

    async def list_personas(self) -> list[Persona]:
        """列出所有可用人设"""
        all_personas = {**self._builtin, **self._custom}
        return list(all_personas.values())

    def register_persona(self, persona: Persona) -> None:
        """注册自定义人设"""
        self._custom[persona.id] = persona
        logger.info("PersonaService: registered custom persona %s", persona.id)


# 默认人设 (用于无匹配时的回退)
DEFAULT_PERSONA = Persona(
    id="default",
    name="General Assistant",
    prompt="",  # 空 prompt，不注入额外人设
    tags=[],
)


# 模块级单例
persona_service = PersonaService()
