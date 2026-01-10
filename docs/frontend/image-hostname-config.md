# Next.js 图片域名动态配置

## 问题背景

在使用 Next.js 的 `<Image>` 组件加载远程图片时,如果图片的 hostname 没有在 `next.config.ts` 的 `images.remotePatterns` 中配置,会报错:

```
Error: Invalid src prop (http://192.168.31.145:8000/media/avatars/xxx.png) on `next/image`, 
hostname "192.168.31.145" is not configured under images in your `next.config.js`
```

## 解决方案

我们修改了 `frontend/next.config.ts`,让它从环境变量 `NEXT_PUBLIC_API_BASE_URL` 中动态读取 API 地址,并自动配置图片域名白名单。

### 配置逻辑

```typescript
remotePatterns: (() => {
  const patterns: Array<{
    protocol: 'http' | 'https';
    hostname: string;
    port?: string;
    pathname: string;
  }> = [];
  
  // 从环境变量读取 API 地址
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
  
  try {
    const url = new URL(apiBaseUrl);
    const protocol = url.protocol.replace(':', '') as 'http' | 'https';
    const port = url.port || (protocol === 'https' ? '' : '');
    
    // 添加 API 地址对应的图片域名
    patterns.push({
      protocol,
      hostname: url.hostname,
      ...(port && { port }),
      pathname: '/media/**',
    });
  } catch (e) {
    // 解析失败时使用默认配置
    console.warn('Invalid NEXT_PUBLIC_API_BASE_URL, using default localhost:8000');
    patterns.push({
      protocol: 'http',
      hostname: 'localhost',
      port: '8000',
      pathname: '/media/**',
    });
  }
  
  // 添加通配符 HTTPS 支持（用于其他 CDN 或外部图片）
  patterns.push({
    protocol: 'https',
    hostname: '**',
    pathname: '/media/**',
  });
  
  return patterns;
})(),
```

## 使用方法

### 1. 配置环境变量

在 `frontend/.env.local` 或 `frontend/.env` 中设置:

```bash
# 开发环境
NEXT_PUBLIC_API_BASE_URL=http://192.168.31.145:8000

# 或生产环境
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
```

### 2. 重启开发服务器

修改环境变量后,需要重启 Next.js 开发服务器才能生效:

```bash
cd frontend
bun run dev
```

### 3. 使用 Image 组件

现在可以正常使用 Next.js 的 `<Image>` 组件加载来自 API 的图片:

```tsx
import Image from 'next/image';

export function UserAvatar({ avatarUrl }: { avatarUrl: string }) {
  return (
    <Image
      src={avatarUrl}  // 例如: http://192.168.31.145:8000/media/avatars/xxx.png
      alt="User Avatar"
      width={40}
      height={40}
      className="rounded-full"
    />
  );
}
```

## 支持的配置示例

### 本地开发

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

生成的配置:
- protocol: `http`
- hostname: `localhost`
- port: `8000`
- pathname: `/media/**`

### 局域网开发

```bash
NEXT_PUBLIC_API_BASE_URL=http://192.168.31.145:8000
```

生成的配置:
- protocol: `http`
- hostname: `192.168.31.145`
- port: `8000`
- pathname: `/media/**`

### 生产环境 (HTTPS)

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
```

生成的配置:
- protocol: `https`
- hostname: `api.example.com`
- port: (空,使用默认 443)
- pathname: `/media/**`

### 生产环境 (自定义端口)

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.example.com:8443
```

生成的配置:
- protocol: `https`
- hostname: `api.example.com`
- port: `8443`
- pathname: `/media/**`

## 注意事项

1. **环境变量必须以 `NEXT_PUBLIC_` 开头**: 这样才能在客户端代码中访问
2. **修改环境变量后需要重启**: Next.js 在构建时读取环境变量,运行时修改不会生效
3. **通配符支持**: 配置中包含 `https://**` 通配符,支持加载任何 HTTPS 图片
4. **路径限制**: 只允许 `/media/**` 路径下的图片,提高安全性

## 相关文件

- `frontend/next.config.ts`: Next.js 配置文件
- `frontend/.env.example`: 环境变量示例
- `frontend/.env.local`: 本地环境变量(不提交到 Git)

## 参考文档

- [Next.js Image Optimization](https://nextjs.org/docs/app/building-your-application/optimizing/images)
- [Next.js Remote Patterns](https://nextjs.org/docs/app/api-reference/components/image#remotepatterns)
