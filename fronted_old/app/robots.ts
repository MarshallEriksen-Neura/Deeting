import { MetadataRoute } from 'next';

/**
 * 生成 robots.txt
 * 控制搜索引擎爬虫的访问规则
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ai-higress.example.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/system/',
          '/dashboard/api-keys',
          '/dashboard/my-providers',
          '/profile',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
