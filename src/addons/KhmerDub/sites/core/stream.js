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

function extractKhmerDramaUrl(html = "") {
  const text = String(html || "")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

  const match = text.match(
    /https?:\/\/(?:video4khmer\.khmerdrama\.org|khmermove\.cinaze\.com)\/(?:tv-series|movies)\/[^"'<>\\\s]+/i
  );

  return match ? match[0] : null;
}

async function fetchKhmerDramaDetail(khmerDramaUrl) {
  const parsedUrl = new URL(khmerDramaUrl);

  const slug = parsedUrl.pathname
    .split("/")
    .filter(Boolean)
    .pop();

  const origin = parsedUrl.origin;

  const apiUrl =
    `${origin}/api/movies.php?find_slug=${encodeURIComponent(slug)}&paginated=1`;

  const { data } = await axiosClient.get(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: khmerDramaUrl
    }
  });

  const found = Array.isArray(data?.data) ? data.data[0] : data?.data;
  if (!found) return null;

  let servers = [];
  try {
    servers = typeof found.servers === "string"
      ? JSON.parse(found.servers)
      : found.servers || [];
  } catch {
    servers = [];
  }

  const episodeMap = new Map();

  servers.forEach((server) => {
    const episodes = Array.isArray(server.episodes) ? server.episodes : [];

    episodes.forEach((ep, index) => {
      const epName =
        typeof ep === "object" && ep?.episode_name
          ? String(ep.episode_name).trim()
          : String(index + 1);

      const epUrl =
        typeof ep === "string"
          ? ep
          : ep?.url || ep?.file || ep?.src || "";

      if (!episodeMap.has(epName)) {
        episodeMap.set(epName, epUrl || "");
      } else if (!episodeMap.get(epName) && epUrl) {
        episodeMap.set(epName, epUrl);
      }
    });
  });

  const urls = [...episodeMap.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, url]) => url)
    .filter(Boolean);

  if (!urls.length) return null;

  return {
    title: found.phoneticTitle || found.title || "PhumiVIP",
    thumbnail: found.poster || found.backdrop || "",
    urls,
    maxEp: urls.length,
    sourceType: "khmerdrama-api"
  };
}

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

  if (seriesUrl) {
    try {
      const { data } = await axiosClient.get(seriesUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: seriesUrl
        }
      });

      const khmerDramaUrl = extractKhmerDramaUrl(data);

      if (khmerDramaUrl) {
        const kdDetail = await fetchKhmerDramaDetail(khmerDramaUrl);

        if (
          kdDetail &&
          Array.isArray(kdDetail.urls) &&
          (!detail || kdDetail.urls.length > (detail.urls?.length || 0))
        ) {
          detail = kdDetail;
        }
      }
    } catch {}
  }

  if (!detail) {
    return null;
  }

  POST_INFO.set(postId, {
    ...(POST_INFO.get(postId) || {}),
    detail,
    maxEp: detail.maxEp || POST_INFO.get(postId)?.maxEp || null,
    sourceType: detail.sourceType || POST_INFO.get(postId)?.sourceType
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
    phumi2: "PhumiClub",
    cat3movie: "Cat3Movie",
    xvideos: "xVideos"
  };

  const providerName = providerNames[prefix] || "KhmerDub";
  const groupName = prefix || "khmerdub";

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

    return buildStream(
      url,
      episode,
      undefined,
      providerName,
      groupName,
      seriesUrl || "https://phumikhmer.vip/"
    );
  }

  if (!postId) return null;

  let detail = await getStreamDetail(postId, seriesUrl);

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

  if (url.includes("ok.ru/videoembed/")) {
    const resolved = await resolveOkEmbed(url);
    if (!resolved) return null;
    url = resolved;
  }

  return buildStream(
    url,
    episode,
    undefined,
    providerName,
    groupName,
    seriesUrl || "https://phumikhmer.vip/"
  );
}

module.exports = {
  FILE_REGEX,
  getStreamDetail,
  getStream,
};
