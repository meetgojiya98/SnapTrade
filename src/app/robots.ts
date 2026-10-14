import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/app', '/demo'] },
    sitemap: 'https://balance-snaptrade.vercel.app/sitemap.xml',
  };
}
