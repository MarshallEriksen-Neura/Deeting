import type {
  KnowledgeFile,
  KnowledgeFolder,
  KnowledgeStats,
  KnowledgeChunk,
} from "@/types/knowledge"

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export const mockFolders: KnowledgeFolder[] = [
  {
    id: "folder-1",
    name: "财务报告",
    parentId: null,
    fileCount: 4,
    createdAt: "2025-09-15T08:00:00Z",
  },
  {
    id: "folder-2",
    name: "会议记录",
    parentId: null,
    fileCount: 3,
    createdAt: "2025-10-01T10:30:00Z",
  },
  {
    id: "folder-3",
    name: "技术文档",
    parentId: null,
    fileCount: 3,
    createdAt: "2025-11-20T14:00:00Z",
  },
  {
    id: "folder-1-1",
    name: "2024年度",
    parentId: "folder-1",
    fileCount: 2,
    createdAt: "2025-12-01T09:00:00Z",
  },
]

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export const mockFiles: KnowledgeFile[] = [
  // Root-level files
  {
    id: "file-1",
    name: "公司介绍.pdf",
    type: "pdf",
    size: 3_200_000,
    status: "active",
    chunks: 245,
    folderId: null,
    createdAt: "2025-08-10T09:15:00Z",
    updatedAt: "2025-08-10T09:20:00Z",
  },
  {
    id: "file-2",
    name: "产品路线图.md",
    type: "md",
    size: 45_000,
    status: "active",
    chunks: 32,
    folderId: null,
    createdAt: "2025-09-05T14:30:00Z",
    updatedAt: "2025-09-05T14:32:00Z",
  },
  {
    id: "file-3",
    name: "客户反馈汇总.xlsx",
    type: "xlsx",
    size: 1_800_000,
    status: "processing",
    chunks: null,
    folderId: null,
    createdAt: "2026-02-06T08:00:00Z",
    updatedAt: "2026-02-06T08:00:00Z",
  },

  // 财务报告 folder
  {
    id: "file-4",
    name: "2024年度财报.pdf",
    type: "pdf",
    size: 5_400_000,
    status: "active",
    chunks: 450,
    folderId: "folder-1",
    createdAt: "2025-10-27T14:30:00Z",
    updatedAt: "2025-10-27T14:45:00Z",
    shareUrl: "https://example.com/share/file-4",
  },
  {
    id: "file-5",
    name: "Q3季度报告.pdf",
    type: "pdf",
    size: 2_100_000,
    status: "active",
    chunks: 188,
    folderId: "folder-1",
    createdAt: "2025-10-15T11:00:00Z",
    updatedAt: "2025-10-15T11:10:00Z",
  },
  {
    id: "file-6",
    name: "预算规划.xlsx",
    type: "xlsx",
    size: 980_000,
    status: "failed",
    chunks: 0,
    errorMessage: "文件已加密，无法解析内容",
    folderId: "folder-1",
    createdAt: "2025-11-01T16:00:00Z",
    updatedAt: "2025-11-01T16:05:00Z",
  },
  {
    id: "file-7",
    name: "税务明细.csv",
    type: "csv",
    size: 320_000,
    status: "active",
    chunks: 67,
    folderId: "folder-1",
    createdAt: "2025-12-10T13:00:00Z",
    updatedAt: "2025-12-10T13:05:00Z",
  },

  // 会议记录 folder
  {
    id: "file-8",
    name: "周会纪要-Week48.txt",
    type: "txt",
    size: 15_000,
    status: "active",
    chunks: 12,
    folderId: "folder-2",
    createdAt: "2025-12-02T10:00:00Z",
    updatedAt: "2025-12-02T10:02:00Z",
  },
  {
    id: "file-9",
    name: "产品评审会.docx",
    type: "docx",
    size: 890_000,
    status: "processing",
    chunks: null,
    folderId: "folder-2",
    createdAt: "2026-02-05T15:30:00Z",
    updatedAt: "2026-02-05T15:30:00Z",
  },
  {
    id: "file-10",
    name: "OKR复盘.md",
    type: "md",
    size: 28_000,
    status: "active",
    chunks: 21,
    folderId: "folder-2",
    createdAt: "2025-12-20T09:45:00Z",
    updatedAt: "2025-12-20T09:47:00Z",
  },

  // 技术文档 folder
  {
    id: "file-11",
    name: "API接口文档.json",
    type: "json",
    size: 156_000,
    status: "active",
    chunks: 89,
    folderId: "folder-3",
    createdAt: "2025-11-25T16:00:00Z",
    updatedAt: "2025-11-25T16:05:00Z",
  },
  {
    id: "file-12",
    name: "架构设计说明.pdf",
    type: "pdf",
    size: 4_200_000,
    status: "active",
    chunks: 356,
    folderId: "folder-3",
    createdAt: "2025-12-05T11:30:00Z",
    updatedAt: "2025-12-05T11:40:00Z",
  },
  {
    id: "file-13",
    name: "部署手册.html",
    type: "html",
    size: 67_000,
    status: "failed",
    chunks: 0,
    errorMessage: "HTML 结构异常，解析超时",
    folderId: "folder-3",
    createdAt: "2026-01-10T08:20:00Z",
    updatedAt: "2026-01-10T08:25:00Z",
  },

  // 2024年度 sub-folder (inside 财务报告)
  {
    id: "file-14",
    name: "年度审计报告.pdf",
    type: "pdf",
    size: 6_800_000,
    status: "processing",
    chunks: null,
    folderId: "folder-1-1",
    createdAt: "2026-02-04T10:00:00Z",
    updatedAt: "2026-02-04T10:00:00Z",
  },
  {
    id: "file-15",
    name: "利润表.csv",
    type: "csv",
    size: 210_000,
    status: "active",
    chunks: 45,
    folderId: "folder-1-1",
    createdAt: "2026-01-20T14:00:00Z",
    updatedAt: "2026-01-20T14:05:00Z",
  },
]

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export const mockStats: KnowledgeStats = {
  usedBytes: 47_000_000, // ~45MB
  totalBytes: 524_288_000, // 500MB
  totalVectors: 2450,
  totalFiles: 15,
  totalFolders: 4,
}

// ---------------------------------------------------------------------------
// Chunks (sample for file-4: 2024年度财报.pdf)
// ---------------------------------------------------------------------------

export const mockChunks: Record<string, KnowledgeChunk[]> = {
  "file-4": [
    {
      id: "chunk-4-0",
      fileId: "file-4",
      index: 0,
      content:
        "2024年度财务报告摘要\n\n本报告涵盖了公司2024财年的整体经营状况。营业收入同比增长23.5%，达到12.8亿元人民币。净利润为2.1亿元，净利润率为16.4%。",
      tokenCount: 128,
    },
    {
      id: "chunk-4-1",
      fileId: "file-4",
      index: 1,
      content:
        "一、收入结构分析\n\n1. SaaS订阅收入：8.2亿元（同比+31%），占总营收64%\n2. 专业服务收入：2.8亿元（同比+12%），占总营收22%\n3. 硬件及其他：1.8亿元（同比+8%），占总营收14%",
      tokenCount: 156,
    },
    {
      id: "chunk-4-2",
      fileId: "file-4",
      index: 2,
      content:
        "二、成本与费用\n\n营业成本总计7.2亿元，毛利率为43.8%，较上年提升2.3个百分点。研发费用投入3.5亿元，占营收27.3%，主要用于AI大模型和向量检索引擎的持续迭代。",
      tokenCount: 142,
    },
    {
      id: "chunk-4-3",
      fileId: "file-4",
      index: 3,
      content:
        "三、现金流情况\n\n经营活动现金流净额为3.8亿元，同比增长45%。投资活动现金流出1.2亿元，主要用于数据中心扩建。融资活动净流入0.5亿元。期末现金及等价物余额为6.7亿元。",
      tokenCount: 138,
    },
    {
      id: "chunk-4-4",
      fileId: "file-4",
      index: 4,
      content:
        "四、业务展望\n\n2025年公司将持续加大AI基础设施投入，预计研发费用占比将提升至30%以上。重点方向包括：多模态RAG系统、Agent编排平台、以及面向垂直行业的解决方案。",
      tokenCount: 145,
    },
  ],
  "file-1": [
    {
      id: "chunk-1-0",
      fileId: "file-1",
      index: 0,
      content:
        "公司简介\n\n我们是一家专注于AI基础设施的科技公司，致力于为企业提供智能化的API网关和AI应用平台。公司成立于2020年，总部位于上海。",
      tokenCount: 98,
    },
    {
      id: "chunk-1-1",
      fileId: "file-1",
      index: 1,
      content:
        "核心产品\n\n1. AI Higress Gateway - 智能API网关\n2. Deeting - AI助手与知识管理平台\n3. Vector Engine - 高性能向量检索引擎\n\n产品覆盖超过500家企业客户，月活跃用户超过100万。",
      tokenCount: 112,
    },
    {
      id: "chunk-1-2",
      fileId: "file-1",
      index: 2,
      content:
        "技术优势\n\n自研的向量检索引擎支持千亿级向量实时检索，延迟低于10ms。AI网关支持多模型路由、流量治理和可观测性，已通过SOC2 Type II认证。",
      tokenCount: 105,
    },
  ],
  "file-12": [
    {
      id: "chunk-12-0",
      fileId: "file-12",
      index: 0,
      content:
        "系统架构概述\n\n本系统采用微服务架构，主要分为以下几层：\n- 接入层：Higress网关 + Nginx\n- 应用层：Next.js前端 + Python FastAPI后端\n- 数据层：PostgreSQL + Qdrant + Redis\n- 基础设施：Kubernetes + ArgoCD",
      tokenCount: 132,
    },
    {
      id: "chunk-12-1",
      fileId: "file-12",
      index: 1,
      content:
        "RAG Pipeline 设计\n\n文档处理流程：\n1. 文件上传至对象存储（MinIO/S3）\n2. 异步任务解析文档（Unstructured/PyPDF）\n3. 文本切片（RecursiveCharacterTextSplitter, chunk_size=512）\n4. Embedding生成（text-embedding-3-small）\n5. 写入Qdrant collection",
      tokenCount: 156,
    },
  ],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get files in a specific folder (or root when folderId is null) */
export function getFilesInFolder(folderId: string | null): KnowledgeFile[] {
  return mockFiles.filter((f) => f.folderId === folderId)
}

/** Get sub-folders of a specific folder (or root-level folders when parentId is null) */
export function getFoldersInFolder(parentId: string | null): KnowledgeFolder[] {
  return mockFolders.filter((f) => f.parentId === parentId)
}

/** Get folder by ID */
export function getFolderById(folderId: string): KnowledgeFolder | undefined {
  return mockFolders.find((f) => f.id === folderId)
}

/** Get file by ID */
export function getFileById(fileId: string): KnowledgeFile | undefined {
  return mockFiles.find((f) => f.id === fileId)
}

/** Get the full breadcrumb path for a folder */
export function getFolderBreadcrumb(
  folderId: string | null
): { id: string | null; name: string }[] {
  const trail: { id: string | null; name: string }[] = []
  let currentId = folderId

  while (currentId) {
    const folder = getFolderById(currentId)
    if (!folder) break
    trail.unshift({ id: folder.id, name: folder.name })
    currentId = folder.parentId
  }

  return trail
}

/** Get chunks for a given file */
export function getChunksForFile(fileId: string): KnowledgeChunk[] {
  return mockChunks[fileId] ?? []
}
