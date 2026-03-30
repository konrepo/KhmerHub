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
   VIP PARSER
========================= */
function parseVipBloggerContent(content = "") {
  const urls = [];
  const okIds = [];

  urls.push(...extractVideoLinks(content));

  let match;

  const dmRegex = /\{dm=(\w+)\}/gi;
  while ((match = dmRegex.exec(content)) !== null) {
    urls.push(`https://www.dailymotion.com/embed/video/${match[1]}`);
  }

  const gdRegex = /\{gd=(\w+)\}/gi;
  while ((match = gdRegex.exec(content)) !== null) {
    urls.push(`https://drive.google.com/file/d/${match[1]}/preview`);
  }

  const okRegex = /\{ok=(\w+)\}/gi;
  while ((match = okRegex.exec(content)) !== null) {
    okIds.push(match[1]);
  }

  if (/\{embed\s*=\s*ok\}/i.test(content)) {
    okIds.forEach((id) => {
      urls.push(`https://ok.ru/videoembed/${id}`);
    });
  }

  const parts = content
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (/^https?:\/\//i.test(part)) {
      urls.push(part);
      continue;
    }

    const dm = part.match(/\{dm=(\w+)\}/i);
    if (dm) {
      urls.push(`https://www.dailymotion.com/embed/video/${dm[1]}`);
      continue;
    }

    const gd = part.match(/\{gd=(\w+)\}/i);
    if (gd) {
      urls.push(`https://drive.google.com/file/d/${gd[1]}/preview`);
      continue;
    }

    const ok = part.match(/\{ok=(\w+)\}/i);
    if (ok) {
      urls.push(`https://ok.ru/videoembed/${ok[1]}`);
    }
  }

  return [...new Set(urls)];
}

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

/* =========================
   GET POST ID
========================= */
async function getPostId(url) {
  if (URL_TO_POSTID.has(url)) {
    return URL_TO_POSTID.get(url);
  }

  const { data } = await axiosClient.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: url
    }
  });

  const $ = cheerio.load(data);

  let postId = null;
  let sourceType = null;

  // VIP / iDrama old blogger style
  postId = $("#player").attr("data-post-id");
  if (postId) {
    sourceType = "blogger";
  }

  // SundayDrama
  if (!postId) {
    const fanta = $('div[id="fanta"][data-post-id]').first();
    if (fanta.length) {
      postId = fanta.attr("data-post-id");
      sourceType = "blogger";
    }
  }

  // Blogger fallback from feed url in page source
  if (!postId) {
    const match = data.match(
      /blogger\.com\/feeds\/\d+\/posts\/default\/(\d+)\?alt=json/i
    );
    if (match) {
      postId = match[1];
      sourceType = "blogger";
    }
  }

  // VIP WordPress fallback
  if (!postId) {
    let match = null;

    const shortlink = $('link[rel="shortlink"]').attr("href") || "";
    match = shortlink.match(/[?&]p=(\d+)/i);

    if (!match) {
      const apiLink =
        $('link[rel="alternate"][type="application/json"]').attr("href") || "";
      match = apiLink.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/i);
    }

    if (!match) {
      const articleId = $("article[id^='post-']").attr("id") || "";
      match = articleId.match(/^post-(\d+)$/i);
    }

    if (!match) {
      const imgPostId = $("img[post-id]").first().attr("post-id");
      if (imgPostId) {
        match = [, imgPostId];
      }
    }

    if (match) {
      postId = match[1];
      sourceType = "vip-wordpress";
    }
  }

  if (!postId) return null;

  const pageTitle = $("title").text().trim();
  let maxEp = extractMaxEpFromTitle(pageTitle);

  if (!maxEp) {
    const epText = $('b:contains("episode/")').first().text() || "";
    const match = epText.match(/episode\/(?:END\.)?(\d+)/i);
    if (match) maxEp = parseInt(match[1], 10);
  }

  const urlObj = new URL(url);
  const slug =
    urlObj.pathname
      .split("/")
      .filter(Boolean)
      .pop() || "";

  const cleanTitle =
    $("meta[property='og:title']").attr("content") ||
    $("h1.entry-title, h1.post-title, h1.single-post-title, title")
      .first()
      .text()
      .trim() ||
    "";

  URL_TO_POSTID.set(url, postId);

  POST_INFO.set(postId, {
    ...(POST_INFO.get(postId) || {}),
    maxEp: maxEp || null,
    sourceType: sourceType || "unknown",
    pageHtml: data,
    slug,
    cleanTitle
  });

  return postId;
}

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

    let urls = parseVipBloggerContent(content);

    if (!urls.length) {
      const hasOkEmbed = /\{embed\s*=\s*ok\}/i.test(content);
      const okIds = extractOkIds(content);

      if (hasOkEmbed && okIds.length) {
        urls = okIds.map((id) => `https://ok.ru/videoembed/${id}`);
      }
    }

    if (!urls.length) return null;

    return { title, thumbnail, urls };
  } catch {
    return null;
  }
}

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

  // 1. direct page scan
  let urls = extractVideoLinks(pageHtml);
  if (urls.length) {
    return {
      title: pageTitle,
      thumbnail,
      urls: [...new Set(urls)]
    };
  }

  // 2. inline scripts scan
  const scripts = $("script")
    .map((_, el) => $(el).html() || "")
    .get()
    .join("\n");

  urls = extractVideoLinks(scripts);
  if (urls.length) {
    return {
      title: pageTitle,
      thumbnail,
      urls: [...new Set(urls)]
    };
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
      return {
        title: wpPost?.title?.rendered || pageTitle,
        thumbnail,
        urls: [...new Set(restUrls)]
      };
    }
  } catch {}

  // 4. search blogger by slug/title
  const searched = await findVipBloggerDetailBySearch(seriesUrl, postId);
  if (searched) {
    if (!searched.thumbnail && thumbnail) {
      searched.thumbnail = thumbnail;
    }
    return searched;
  }

  return null;
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

    detail = results.find(Boolean);
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
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl) {
  const postId = await getPostId(seriesUrl);

  // Sunday playlist fallback
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

  const detail = await getStreamDetail(postId, seriesUrl);

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
    title: `Episode ${index + 1}`,
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
