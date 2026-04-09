const axiosClient = require("../../utils/fetch");
const { POST_INFO, BLOG_IDS } = require("../../utils/cache");
const { extractVideoLinks } = require("../../utils/helpers");
const {
  resolvePlayerUrl,
  resolveOkEmbed,
  buildStream
} = require("../../utils/streamResolvers");
const { getPostId } = require("./postId");
const { fetchFromBlog } = require("./blogger");
const { fetchVipWordpressDetail } = require("./wordpress");

const FILE_REGEX =
  /file\s*:\s*["'](https?:\/\/[^"']+\.mp4(?:\?[^"']+)?)["']/gi;

/* =========================
   STREAM DETAIL
========================= */
async function getStreamDetail(postId, seriesUrl = "") {
  const cached = POST_INFO.get(postId);
  if (cached?.detail) return cached.detail;

  const sourceType = cached?.sourceType || "blogger";
  let detail = null;

  if (sourceType === "vip-wordpress") {
    detail = await fetchVipWordpressDetail(seriesUrl, postId);
  } else {
    const results = await Promise.all(
      Object.values(BLOG_IDS).map((blogId) =>
        fetchFromBlog(blogId, postId)
      )
    );

    const validResults = results.filter(
      (item) => item && Array.isArray(item.urls) && item.urls.length
    );

    if (validResults.length) {
      detail = validResults.sort((a, b) => b.urls.length - a.urls.length)[0];
    }
  }

  if (!detail) {
    return null;
  }

  POST_INFO.set(postId, {
    ...(POST_INFO.get(postId) || {}),
    detail
  });

  return detail;
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, seriesUrl, episode) {
  const postId = await getPostId(seriesUrl);

  const providerNames = {
    vip: "PhumiVIP",
    sunday: "SundayDrama",
    idrama: "iDramaHD",
    khmerave: "KhmerAve",
    merlkon: "Merlkon",
    phumi2: "PhumiClub"
  };

  const providerName = providerNames[prefix] || "KhmerDub";
  const groupName = prefix || "khmerdub";

  // Sunday fallback streaming
  if (prefix === "sunday" && !postId) {
    const { data } = await axiosClient.get(seriesUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: seriesUrl
      }
    });

    const links = extractVideoLinks(data);
    const url = links[episode - 1];
    if (!url) return null;

    return buildStream(url, episode, undefined, providerName, groupName, seriesUrl);
  }

  if (!postId) return null;

  let detail = await getStreamDetail(postId, seriesUrl);

  // vip direct fallback
  if (!detail && prefix === "vip") {
    try {
      const { data } = await axiosClient.get(seriesUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: seriesUrl
        }
      });

      const fallbackUrls = extractVideoLinks(data);
      if (fallbackUrls.length) {
        detail = {
          title: "VIP",
          thumbnail: "",
          urls: fallbackUrls
        };
      }
    } catch {}
  }

  if (!detail) return null;

  let url = detail.urls[episode - 1];
  if (!url) return null;

  if (url.includes("player.php")) {
    const resolved = await resolvePlayerUrl(url);
    if (!resolved) return null;
    url = resolved;
  }
  
  console.log("[VIP final stream url]", {
    episode,
    url
  });
  

  if (url.includes("ok.ru/videoembed/")) {
    const resolved = await resolveOkEmbed(url);
    if (!resolved) return null;
    url = resolved;
  }

  return buildStream(url, episode, undefined, providerName, groupName, seriesUrl);
}

module.exports = {
  FILE_REGEX,
  getStreamDetail,
  getStream,
};