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

function extractKhmerMoviePlayerConfig(html = "") {
  const text = String(html || "")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

  const postId =
    text.match(/data-postid=["'](\d+)["']/i)?.[1] || "";

  const accessToken =
    text.match(/data-access-token=["']([^"']+)["']/i)?.[1] || "";

  const freeEps = parseInt(
    text.match(/data-freeeps=["'](\d+)["']/i)?.[1] || "0",
    10
  );

  const isPremium =
    text.match(/data-premium=["']([^"']+)["']/i)?.[1] === "true";

  const isUnlocked =
    text.match(/data-unlocked=["']([^"']+)["']/i)?.[1] === "true";

  const playerSettingsMatch = text.match(
    /var\s+PLAYER_SETTINGS\s*=\s*(\{.*?\});/is
  );

  let nonce = "";
  let ajaxUrl = "https://khmer-movie.org/wp-admin/admin-ajax.php";

  if (playerSettingsMatch?.[1]) {
    const playerSettingsText = playerSettingsMatch[1];

    nonce =
      playerSettingsText.match(
        /["']nonce["']\s*:\s*["']([^"']+)["']/i
      )?.[1] || "";

    ajaxUrl =
      playerSettingsText.match(
        /["']ajaxUrl["']\s*:\s*["']([^"']+)["']/i
      )?.[1] ||
      ajaxUrl;
  }

  if (!postId || !accessToken || !nonce) {
    return null;
  }

  return {
    postId,
    accessToken,
    freeEps,
    isPremium,
    isUnlocked,
    nonce,
    ajaxUrl
  };
}

async function resolveKhmerMovieEpisode(pageUrl, episode) {
  try {
    const { data: html } = await axiosClient.get(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: pageUrl
      }
    });

    const config = extractKhmerMoviePlayerConfig(html);
    if (!config) return null;

    const episodeIndex = episode - 1;

    if (
      config.isPremium &&
      !config.isUnlocked &&
      episodeIndex >= config.freeEps
    ) {
      return null;
    }

    const body = new URLSearchParams({
      action: "anc_player_resolve_source",
      nonce: config.nonce,
      access_token: config.accessToken,
      post_id: config.postId,
      episode: String(episodeIndex)
    });

    const { data } = await axiosClient.post(
      config.ajaxUrl,
      body.toString(),
      {
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Mozilla/5.0",
          Referer: pageUrl
        }
      }
    );

    if (!data?.success || !data?.data?.url) {
      return null;
    }

    return data.data.url;
  } catch (err) {
    return null;
  }
}

async function fetchKhmerMovieDetail(seriesUrl) {
  try {
    const parsedUrl = new URL(seriesUrl);

    const slug = parsedUrl.pathname
      .split("/")
      .filter(Boolean)
      .pop();

    if (!slug) return null;

    const baseUrl =
      `https://khmer-movie.org/tv-shows/${encodeURIComponent(slug)}/`;

    const firstEpisodeUrl = `${baseUrl}?ep=1`;

    const { data: html } = await axiosClient.get(firstEpisodeUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: seriesUrl
      }
    });

    const config = extractKhmerMoviePlayerConfig(html);
    if (!config) return null;

    const episodeCount = config.freeEps;

    if (!episodeCount) return null;

    const text = String(html || "")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    const title =
      text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      text.match(/<title>([^<]+)<\/title>/i)?.[1] ||
      slug;

    const thumbnail =
      text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      "";

    const urls = Array.from(
      { length: episodeCount },
      (_, index) => `${baseUrl}?ep=${index + 1}`
    );

    return {
      title,
      thumbnail,
      urls,
      maxEp: urls.length,
      sourceType: "khmer-movie"
    };
  } catch {
    return null;
  }
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
      let pageHtml = cached?.pageHtml || "";

      // Only fetch when getPostId did not already cache the page.
      if (!pageHtml) {
        const { data } = await axiosClient.get(seriesUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Referer: seriesUrl
          }
        });

        pageHtml = data || "";
      }

      const khmerDramaUrl = extractKhmerDramaUrl(pageHtml);

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

  if (!detail && seriesUrl) {
    try {
      const hostname = new URL(seriesUrl).hostname.replace(/^www\./, "");

      if (hostname === "phumikhmer.vip") {
        detail = await fetchKhmerMovieDetail(seriesUrl);
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

  if (/https?:\/\/(?:www\.)?khmer-movie\.org\//i.test(url)) {
    const resolved = await resolveKhmerMovieEpisode(url, episode);
    if (!resolved) return null;
    url = resolved;
  }

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
