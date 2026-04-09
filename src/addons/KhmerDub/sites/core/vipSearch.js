const cheerio = require("cheerio");
const axiosClient = require("../../utils/fetch");
const { POST_INFO, BLOG_IDS } = require("../../utils/cache");
const { normalizePoster } = require("../../utils/helpers");
const { parseVipBloggerContent } = require("./vipParser");

/* =========================
   VIP SEARCH HELPERS
========================= */
function normalizeSearchText(text = "") {
  return text
    .toLowerCase()
    .replace(/&#8217;|&#8216;|&#8220;|&#8221;/g, " ")
    .replace(/[^\w\s]+/g, " ")
    .replace(/\b(ep|episode|part|end)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCandidate(title = "", slug = "", targetTitle = "", targetSlug = "") {
  const t = normalizeSearchText(title);
  const tt = normalizeSearchText(targetTitle);
  const s = (slug || "").toLowerCase().trim();
  const ts = (targetSlug || "").toLowerCase().trim();

  let score = 0;

  if (ts && s === ts) score += 100;
  if (ts && s.includes(ts)) score += 40;
  if (ts && ts.includes(s) && s) score += 20;

  if (tt && t === tt) score += 80;
  if (tt && t.includes(tt)) score += 35;
  if (tt && tt.includes(t) && t) score += 15;

  return score;
}

async function searchVipBloggerPosts(blogId, query) {
  const feedUrl =
    `https://www.blogger.com/feeds/${blogId}/posts/default` +
    `?alt=json&max-results=20&q=${encodeURIComponent(query)}`;

  try {
    const { data } = await axiosClient.get(feedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://phumikhmer.vip/"
      }
    });

    const entries = data?.feed?.entry || [];
    return Array.isArray(entries) ? entries : [entries];
  } catch {
    return [];
  }
}

async function findVipBloggerDetailBySearch(seriesUrl, postId) {
  const cached = POST_INFO.get(postId) || {};
  const targetSlug = cached.slug || "";
  const targetTitle = cached.cleanTitle || "";

  const vipBlogs = [BLOG_IDS.ONELEGEND, BLOG_IDS.KOLAB];
  const queries = [...new Set([targetSlug, targetTitle].filter(Boolean))];

  let best = null;

  for (const blogId of vipBlogs) {
    for (const query of queries) {
      const entries = await searchVipBloggerPosts(blogId, query);

      for (const entry of entries) {
        const title = entry?.title?.$t || "";
        const content = entry?.content?.$t || "";
        const links = entry?.link || [];

        const altLinkObj = links.find((l) => l.rel === "alternate");
        const entryUrl = altLinkObj?.href || "";
        const entrySlug = entryUrl
          .split("/")
          .filter(Boolean)
          .pop() || "";

        const score = scoreCandidate(title, entrySlug, targetTitle, targetSlug);
        if (score < 30) continue;

        const urls = parseVipBloggerContent(content);
        if (!urls.length) continue;

        const $content = cheerio.load(content);
        const thumbnail = normalizePoster(
          $content("img").first().attr("src") ||
          entry.media$thumbnail?.url ||
          ""
        );

        const candidate = {
          title,
          thumbnail,
          urls,
          score,
          blogId,
          entryUrl
        };

        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      }
    }
  }

  if (!best) return null;

  return {
    title: best.title,
    thumbnail: best.thumbnail,
    urls: best.urls
  };
}

module.exports = {
  normalizeSearchText,
  scoreCandidate,
  searchVipBloggerPosts,
  findVipBloggerDetailBySearch,
};