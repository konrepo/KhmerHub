const cheerio = require("cheerio");
const axiosClient = require("../utils/fetch");
const { URL_TO_POSTID, POST_INFO, BLOG_IDS } = require("../utils/cache");
const { 
  normalizePoster, 
  extractVideoLinks, 
  extractMaxEpFromTitle, 
  extractOkIds, 
  uniqById
} = require("../utils/helpers");

const FILE_REGEX =
  /file\s*:\s*["'](https?:\/\/[^"']+\.mp4(?:\?[^"']+)?)["']/gi;  

const {
  resolvePlayerUrl,
  resolveOkEmbed,
  buildStream
} = require("../utils/streamResolvers");

/* =========================
   GET POST ID
========================= */
async function getPostId(url) {
  if (URL_TO_POSTID.has(url)) {
	  return URL_TO_POSTID.get(url);
  }

  const { data } = await axiosClient.get(url);
  const $ = cheerio.load(data);

  // VIP / iDrama
  let postId = $("#player").attr("data-post-id");

  // SundayDrama
  if (!postId) {
    const fanta = $('div[id="fanta"][data-post-id]').first();
    if (fanta.length) {
      postId = fanta.attr("data-post-id");
    }
  }
  
  // SundayDrama fallback
  if (!postId) {
    const match = data.match(
      /blogger\.com\/feeds\/\d+\/posts\/default\/(\d+)\?alt=json/i
    );
    if (match) {
      postId = match[1];
    }
  }  

  if (!postId) return null;
  
  // Extract max EP from title OR from SundayDrama "episode/END.xx"
  const pageTitle = $("title").text();
  let maxEp = extractMaxEpFromTitle(pageTitle);

  // SundayDrama often has: <b>episode/END.70</b>
  if (!maxEp) {
    const epText =
      $('b:contains("episode/")').first().text() || "";

    const m = epText.match(/episode\/(?:END\.)?(\d+)/i);
    if (m) maxEp = parseInt(m[1], 10);
  } 

  URL_TO_POSTID.set(url, postId);

  if (maxEp) {
    POST_INFO.set(postId, {
      ...(POST_INFO.get(postId) || {}),
      maxEp,
    });
  }

  return postId;
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

    let urls = extractVideoLinks(content);

    // If blogger post stores OK.ru IDs (like: 9488...; 9488...; {embed=ok})
    if (!urls.length) {
      const hasOkEmbed = /\{embed\s*=\s*ok\}/i.test(content);
      const okIds = extractOkIds(content);

      if (hasOkEmbed && okIds.length) {
		urls = okIds.map(id => `https://ok.ru/videoembed/${id}`);
      }
    }

    if (!urls.length) return null;

    return { title, thumbnail, urls };
  } catch {
    return null;
  }
}

/* =========================
   STREAM DETAIL
========================= */
async function getStreamDetail(postId) {
  const cached = POST_INFO.get(postId);
  if (cached?.detail) return cached.detail;

  const results = await Promise.all(
    Object.values(BLOG_IDS).map(blogId =>
      fetchFromBlog(blogId, postId)
    )
  );

  const detail = results.find(Boolean);
  if (!detail) {
    return null;
  }

  POST_INFO.set(postId, { ...(POST_INFO.get(postId) || {}), detail });

  return detail;
}

/* =========================
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl) {
  const postId = await getPostId(seriesUrl);

  // Sunday playlist
  if (!postId && prefix === "sunday") {  
    const { data } = await axiosClient.get(seriesUrl);

    FILE_REGEX.lastIndex = 0;

    const urls = [];
    let match;

    while ((match = FILE_REGEX.exec(data)) !== null) {
      urls.push(match[1]);
    }

    const $ = cheerio.load(data);	
    const pagePoster =
      $("meta[property='og:image']").attr("content") ||
      $("link[rel='image_src']").attr("href") ||
      "";

    const normalizedPoster = normalizePoster(pagePoster);

    return urls.map((url, index) => ({
      id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:${index + 1}`,
      title: `Episode ${index + 1}`,
      season: 1,
      episode: index + 1,
      thumbnail: normalizedPoster,
      released: new Date().toISOString(),
    }));
  }

  if (!postId) {
    return [];
  }

  const detail = await getStreamDetail(postId);

  if (!detail) {
    return [];
  }

  const maxEp = POST_INFO.get(postId)?.maxEp || null;

  let urls = [...new Set(detail.urls)];

  if (maxEp && urls.length > maxEp) {
    urls = urls.slice(0, maxEp);
  }

  return urls.map((url, index) => ({
    id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:${index + 1}`,
    title: detail.title,
    season: 1,
    episode: index + 1,
    thumbnail: detail.thumbnail,
    released: new Date().toISOString(),
  }));
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

    return buildStream(url, episode, undefined, providerName, groupName);
  }

  if (!postId) return null;

  const detail = await getStreamDetail(postId);
  if (!detail) return null;

  let url = detail.urls[episode - 1];
  if (!url) return null;

  // Resolve player.php
  if (url.includes("player.php")) {
    const resolved = await resolvePlayerUrl(url);
    if (!resolved) return null;
    url = resolved;
  }

  // Resolve OK embed
  if (url.includes("ok.ru/videoembed/")) {
    const resolved = await resolveOkEmbed(url);
    if (!resolved) return null;
    url = resolved;
  }

  return buildStream(url, episode, undefined, providerName, groupName);
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix, siteConfig, url) {
  try {

    // === Sunday Blogger Pagination Support ===
    if (prefix === "sunday") {
      const allItems = [];
      let currentUrl = url;
      const BLOGGER_PAGES_PER_BATCH = 3;

      for (let i = 0; i < BLOGGER_PAGES_PER_BATCH && currentUrl; i++) {
        const { data: pageData } = await axiosClient.get(currentUrl);
        const $$ = cheerio.load(pageData);

        const articles = $$(siteConfig.articleSelector).toArray();

        for (const el of articles) {
          const $el = $$(el);
          const a = $el.find(siteConfig.titleSelector).first();

          const title =
            a.attr("title")?.trim() ||
            a.text().trim();

          const link = a.attr("href");
          if (!title || !link) continue;

          let poster = "";
          const posterEl = $el.find(siteConfig.posterSelector).first();
          for (const attr of siteConfig.posterAttrs) {
            poster = posterEl.attr(attr) || poster;
            if (poster) break;
          }

          const normalizedPoster = normalizePoster(poster);

          allItems.push({
            id: `${prefix}:${encodeURIComponent(link)}`,
            name: title,
            poster: normalizedPoster,
          });
        }

        const older = $$("a.blog-pager-older-link").attr("href");
        currentUrl = older || null;
      }

      return uniqById(allItems);
    }

    const { data } = await axiosClient.get(url);
    const $ = cheerio.load(data);

    const articles = $(siteConfig.articleSelector).toArray();

    const results = articles.map((el) => {
      const $el = $(el);
      const a = $el.find(siteConfig.titleSelector).first();

      const title = a.text().trim();
      const link = a.attr("href");
      if (!title || !link) return null;

      let poster = "";
      const posterEl = $el.find(siteConfig.posterSelector).first();
      for (const attr of siteConfig.posterAttrs) {
        poster = posterEl.attr(attr) || poster;
        if (poster) break;
      }

      const normalizedPoster = normalizePoster(poster);

      return {
        id: `${prefix}:${encodeURIComponent(link)}`,
        name: title,
        poster: normalizedPoster,
      };
    });

    return results.filter(Boolean);

  } catch {
    return [];
  }
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
};
