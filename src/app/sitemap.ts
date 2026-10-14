import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/guide', '/support', '/privacy'].map((path) => ({
    url: `https://balance-snaptrade.vercel.app${path === '/' ? '' : path}`,
  }));
}
