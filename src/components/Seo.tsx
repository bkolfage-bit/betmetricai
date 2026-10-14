import { useEffect } from "react";

/**
 * Per-page SEO — updates document title, meta description, canonical URL and
 * the Open Graph / Twitter title+description as the user navigates the SPA.
 * Social crawlers read the static index.html tags; these updates make the
 * in-browser experience (tab titles, shares from specific pages) page-aware.
 */
export function Seo({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  useEffect(() => {
    const fullTitle = title.includes("BetMetricAi") ? title : `${title} — BetMetricAi`;
    document.title = fullTitle;
    const url = `https://betmetric.kimi.pro${path}`;

    const set = (selector: string, attr: string, value: string) => {
      const el = document.head.querySelector(selector);
      if (el) el.setAttribute(attr, value);
    };
    set('meta[name="description"]', "content", description);
    set('meta[name="title"]', "content", fullTitle);
    set('meta[property="og:title"]', "content", fullTitle);
    set('meta[property="og:description"]', "content", description);
    set('meta[property="og:url"]', "content", url);
    set('meta[name="twitter:title"]', "content", fullTitle);
    set('meta[name="twitter:description"]', "content", description);
    set('meta[name="twitter:url"]', "content", url);
    set('link[rel="canonical"]', "href", url);
  }, [title, description, path]);

  return null;
}
