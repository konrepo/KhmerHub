const cheerio = require("cheerio");
const axiosClient = require("../../utils/fetch");
const { POST_INFO, BLOG_IDS } = require("../../utils/cache");
const { normalizePoster, extractVideoLinks } = require("../../utils/helpers");
const { findVipBloggerDetailBySearch } = require("./vipSearch");
const { fetchFromBlog } = require("./blogger");

/* =========================
   FETCH VIP WORDPRESS
========================= */
async function fetchVipWordpressDetail(seriesUrl, postId) {
  const cached = POST_INFO.get(postId) || {};

  let pageHtml = cached.pageHtml;
  if (!pageHtml) {
    const { data } = await axiosClient.get(seriesUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: seriesUrl
      }
    });
    pageHtml = data;
  }

  const $ = cheerio.load(pageHtml);

  const pageTitle =
    $("h1.single-post-title .post-title").text().trim() ||
    $("meta[property='og:title']").attr("content") ||
    $("title").text().trim();

  let thumbnail =
    $("meta[property='og:image']").attr("content") ||
    $("meta[name='twitter:image']").attr("content") ||
    $("img[post-id]").first().attr("src") ||
    $("img[post-id]").first().attr("data-src") ||
    "";

  thumbnail = normalizePoster(thumbnail);

  const candidates = [];

  // 1. direct page scan
  let urls = extractVideoLinks(pageHtml);
  if (urls.length) {
    candidates.push({
      title: pageTitle,
      thumbnail,
      urls: [...new Set(urls)]
    });
  }

  // 2. inline scripts scan
  const scripts = $("script")
    .map((_, el) => $(el).html() || "")
    .get()
    .join("\n");

  urls = extractVideoLinks(scripts);
  if (urls.length) {
    candidates.push({
      title: pageTitle,
      thumbnail,
      urls: [...new Set(urls)]
    });
  }

  // 3. wp-json post content scan
  try {
    const wpApiUrl = `https://phumikhmer.vip/wp-json/wp/v2/posts/${postId}`;
    const { data: wpPost } = await axiosClient.get(wpApiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: seriesUrl
      }
    });

    const rendered = wpPost?.content?.rendered || "";
    const restUrls = extractVideoLinks(rendered);

    if (restUrls.length) {
      candidates.push({
        title: wpPost?.title?.rendered || pageTitle,
        thumbnail,
        urls: [...new Set(restUrls)]
      });
    }
  } catch {}

  // 4. player data-post-id blogger fallback
  const playerPostId = $("#player").attr("data-post-id") || "";

  if (playerPostId) {
    const results = await Promise.all(
      Object.values(BLOG_IDS).map((blogId) =>
        fetchFromBlog(blogId, playerPostId)
      )
    );

    const validResults = results.filter(
      (item) => item && Array.isArray(item.urls) && item.urls.length
    );

    if (validResults.length) {
      const best = validResults.sort((a, b) => b.urls.length - a.urls.length)[0];

      candidates.push({
        title: best.title || pageTitle,
        thumbnail: best.thumbnail || thumbnail,
        urls: [...new Set(best.urls)]
      });
    }
  }

  // 5. search blogger by slug/title
  const searched = await findVipBloggerDetailBySearch(seriesUrl, postId);
  if (searched?.urls?.length) {
    candidates.push({
      title: searched.title || pageTitle,
      thumbnail: searched.thumbnail || thumbnail,
      urls: [...new Set(searched.urls)]
    });
  }

  if (!candidates.length) return null;

  return candidates.sort((a, b) => b.urls.length - a.urls.length)[0];
}

module.exports = {
  fetchVipWordpressDetail,
};