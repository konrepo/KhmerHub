const cheerio = require("cheerio");
const axiosClient = require("../../utils/fetch");
const { extractOkIds, normalizePoster } = require("../../utils/helpers");
const { parseVipBloggerContent } = require("./vipParser");

/* =========================
   BLOGGER FETCH JSON
========================= */
async function fetchBloggerJson(blogId, postId) {
  const feedUrl = `https://www.blogger.com/feeds/${blogId}/posts/default/${postId}?alt=json`;

  try {
    const { data } = await axiosClient.get(feedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://phumikhmer.vip/"
      }
    });

    return data?.entry || null;
  } catch {
    return null;
  }
}

/* =========================
   BLOGGER FETCH
========================= */
async function fetchFromBlog(blogId, postId) {
  const feedUrl = `https://www.blogger.com/feeds/${blogId}/posts/default/${postId}?alt=json`;

  try {
    const { data } = await axiosClient.get(feedUrl);

    const title = data.entry.title.$t;
    const content = data.entry.content?.$t || "";
    const $content = cheerio.load(content);

    let thumbnail =
      $content('meta[property="og:image"]').attr("content") ||
      $content('meta[name="twitter:image"]').attr("content") ||
      $content("img").first().attr("src") ||
      data.entry.media$thumbnail?.url ||
      "";

    thumbnail = normalizePoster(thumbnail);

    const hasOkEmbed = /\{embed\s*=\s*ok\}/i.test(content);
    const okIds = extractOkIds(content);

    let urls = [];

    if (hasOkEmbed && okIds.length) {
      urls.push(...okIds.map((id) => `https://ok.ru/videoembed/${id}`));
    }

    urls.push(...parseVipBloggerContent(content));

    urls = [...new Set(urls)];

    if (!urls.length) return null;

    return { title, thumbnail, urls };
  } catch {
    return null;
  }
}

module.exports = {
  fetchBloggerJson,
  fetchFromBlog,
};