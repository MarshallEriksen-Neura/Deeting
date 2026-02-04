"""
Semantic Kernel 模块

提供动态 System Prompt 组装能力：
- Persona Adaptation: 基于工具类型自动切换人设
- Memory Injection: 检索相关记忆注入 Prompt
- Bandit 集成: Persona 选择的强化学习优化
"""

from app.services.semantic_kernel.memory_service import (
    BaseMemoryService,
    MemoryItem,
    NoopMemoryService,
    QdrantMemoryService,
    get_memory_service,
    memory_service,
)
from app.services.semantic_kernel.persona_service import (
    BUILTIN_PERSONAS,
    DEFAULT_PERSONA,
    Persona,
    PersonaService,
    persona_service,
)
from app.services.semantic_kernel.semantic_kernel_service import (
    CORE_IDENTITY_PROMPT,
    SCENE_PERSONA,
    PromptAssemblyResult,
    SemanticKernelService,
    get_semantic_kernel_service,
    semantic_kernel_service,
)

__all__ = [
    # Memory
    "BaseMemoryService",
    "MemoryItem",
    "NoopMemoryService",
    "QdrantMemoryService",
    "get_memory_service",
    "memory_service",
    # Persona
    "DEFAULT_PERSONA",
    "BUILTIN_PERSONAS",
    "Persona",
    "PersonaService",
    "persona_service",
    # Semantic Kernel
    "CORE_IDENTITY_PROMPT",
    "SCENE_PERSONA",
    "PromptAssemblyResult",
    "SemanticKernelService",
    "get_semantic_kernel_service",
    "semantic_kernel_service",
]
