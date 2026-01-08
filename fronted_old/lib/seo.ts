import { Metadata } from 'next';

/**
 * SEO 配置工具函数
 */

interface SEOConfig {
  title: string;
  description: string;
  keywords?: string[];
  path?: string;
  image?: string;
  noIndex?: boolean;
  locale?: 'zh_CN' | 'en_US';
}

/**
 * 生成页面元数据
 */
export function generateMetadata(config: SEOConfig): Metadata {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ai-higress.example.com';
  const {
    title,
    description,
    keywords = [],
    path = '',
    image = '/og-image.png',
    noIndex = false,
    locale = 'zh_CN',
  } = config;

  const fullTitle = `${title} | AI Higress Gateway`;
  const url = `${baseUrl}${path}`;
  const imageUrl = image.startsWith('http') ? image : `${baseUrl}${image}`;

  const metadata: Metadata = {
    title: fullTitle,
    description,
    keywords: keywords.join(', '),
    authors: [{ name: 'AI Higress Team' }],
    creator: 'AI Higress',
    publisher: 'AI Higress',
    robots: noIndex ? 'noindex, nofollow' : 'index, follow',
    alternates: {
      canonical: url,
      languages: {
        'zh-CN': locale === 'zh_CN' ? url : `${baseUrl}/zh${path}`,
        'en-US': locale === 'en_US' ? url : `${baseUrl}/en${path}`,
      },
    },
    openGraph: {
      type: 'website',
      locale,
      url,
      title: fullTitle,
      description,
      siteName: 'AI Higress Gateway',
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [imageUrl],
      creator: '@ai_higress',
    },
    verification: {
      // 添加搜索引擎验证码（需要时填写）
      google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
      yandex: process.env.NEXT_PUBLIC_YANDEX_VERIFICATION,
      // yahoo: 'yahoo-verification-code',
      // other: 'other-verification-code',
    },
  };

  return metadata;
}

/**
 * 生成结构化数据（JSON-LD）
 */
export function generateJsonLd(type: 'Organization' | 'WebSite' | 'WebPage', data: any) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ai-higress.example.com';

  const schemas: Record<string, any> = {
    Organization: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'AI Higress',
      url: baseUrl,
      logo: `${baseUrl}/logo.png`,
      description: 'AI 智能路由网关系统 - 统一管理多个 AI 提供商',
      ...data,
    },
    WebSite: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'AI Higress Gateway',
      url: baseUrl,
      description: 'AI 智能路由网关系统',
      potentialAction: {
        '@type': 'SearchAction',
        target: `${baseUrl}/search?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
      ...data,
    },
    WebPage: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      url: data.url || baseUrl,
      name: data.name || 'AI Higress Gateway',
      description: data.description || 'AI 智能路由网关系统',
      ...data,
    },
  };

  return schemas[type];
}

/**
 * 默认 SEO 关键词
 */
export const defaultKeywords = [
  'AI Gateway',
  'AI 网关',
  'API Gateway',
  '智能路由',
  'AI 提供商',
  'OpenAI',
  'Claude',
  'Gemini',
  '模型路由',
  'AI 管理',
  'API 管理',
];

/**
 * 页面特定的 SEO 配置
 */
export const pageSEOConfig = {
  home: {
    title: '首页',
    description: 'AI Higress - 智能 AI 路由网关，统一管理多个 AI 提供商，提供高效的模型路由和 API 管理服务',
    keywords: [...defaultKeywords, '首页', 'Home'],
  },
  overview: {
    title: '概览',
    description: '查看系统概览、使用统计和关键指标，实时监控 AI 服务的运行状态',
    keywords: [...defaultKeywords, '概览', 'Dashboard', '统计'],
  },
  providers: {
    title: '提供商管理',
    description: '管理和配置 AI 提供商，包括 OpenAI、Claude、Gemini 等主流 AI 服务',
    keywords: [...defaultKeywords, '提供商', 'Providers', 'AI 服务'],
  },
  logicalModels: {
    title: '逻辑模型',
    description: '配置和管理逻辑模型，实现智能路由和负载均衡',
    keywords: [...defaultKeywords, '逻辑模型', 'Models', '路由'],
  },
  apiKeys: {
    title: 'API 密钥',
    description: '管理 API 密钥，控制访问权限和使用配额',
    keywords: [...defaultKeywords, 'API Key', '密钥', '权限'],
  },
  credits: {
    title: '额度管理',
    description: '查看和管理使用额度，追踪消费记录',
    keywords: [...defaultKeywords, '额度', 'Credits', '消费'],
  },
  metrics: {
    title: '指标监控',
    description: '实时监控系统指标、性能数据和使用情况',
    keywords: [...defaultKeywords, '指标', 'Metrics', '监控', 'Performance'],
  },
};
