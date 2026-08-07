const cheerio = require("cheerio");
const axiosClient = require("../utils/fetch");

const {
    normalizePoster,
    uniqById
} = require("../utils/helpers");

const {
    resolvePlayerUrl,
    resolveOkEmbed,
    resolveScreenPal,
    buildStream,
    buildYouTubeStreams
} = require("../utils/streamResolvers");

/* =========================
   CONFIG
========================= */

const SITE_NAME = "TheKomsan";
const GROUP_NAME = "thekomsan";
const DEFAULT_BASE_URL = "https://www.thekomsan.com";

const PAGE_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
    Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
};

const PAGE_DETAIL_CACHE = new Map();
const PAGE_CACHE_TTL = 5 * 60 * 1000;

const REQUEST_RETRIES = 3;
const RETRY_DELAY = 700;

/* =========================
   GENERAL HELPERS
========================= */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanTitle(text) {
    return String(text || "")
        .replace(/&#8203;/gi, "")
        .replace(/\u200B/g, "")
        .replace(/&amp;/gi, "&")
        .replace(/&#8217;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function isBlockedPage(html) {
    const text = String(html || "");

    return (
        /Our systems have detected unusual traffic/i.test(text) ||
        /g-recaptcha/i.test(text) ||
        /\/sorry\/index/i.test(text) ||
        /captcha-form/i.test(text)
    );
}

function absolutizeUrl(url, baseUrl = DEFAULT_BASE_URL) {
    if (!url) return "";

    const value = String(url).trim();

    if (
        !value ||
        value === "#" ||
        /^javascript:/i.test(value) ||
        /^data:/i.test(value) ||
        /^mailto:/i.test(value) ||
        /^tel:/i.test(value) ||
        /^void\s*\(/i.test(value)
    ) {
        return "";
    }

    try {
        const resolved = new URL(value, baseUrl);

        if (!/^https?:$/.test(resolved.protocol)) {
            return "";
        }

        return resolved.toString();
    } catch {
        return "";
    }
}

function isValidTheKomsanPostUrl(url) {
    if (!url) return false;

    try {
        const parsed = new URL(url);

        const validHost =
            parsed.hostname === "www.thekomsan.com" ||
            parsed.hostname === "thekomsan.com";

        const isPost =
            /\/\d{4}\/\d{2}\/[^/?#]+\.html$/i.test(parsed.pathname);

        return validHost && isPost;
    } catch {
        return false;
    }
}

function normalizeTheKomsanPoster(url) {
    if (!url) return "";

    return normalizePoster(
        String(url)
            .trim()
            .replace(/\/s\d+(?:-[a-z0-9-]+)?\//gi, "/s0/")
            .replace(/\/w\d+-h\d+[^/]*\//gi, "/s0/")
            .replace(/=s\d+(?:-[a-z0-9-]+)?/gi, "=s0")
            .replace(/=w\d+-h\d+[^&]*/gi, "=s0")
    );
}

function normalizeVideoUrl(url, baseUrl = DEFAULT_BASE_URL) {
    if (!url) return "";

    let normalized = String(url)
        .trim()
        .replace(/&amp;/gi, "&")
        .replace(/\\u0026/gi, "&")
        .replace(/\\\//g, "/");

    if (normalized.startsWith("//")) {
        normalized = `https:${normalized}`;
    } else if (normalized.startsWith("/")) {
        normalized = absolutizeUrl(normalized, baseUrl);
    }

    normalized = normalized.replace(/^http:\/\//i, "https://");

    normalized = normalized.replace(
        /^https?:\/\/m\.ok\.ru\//i,
        "https://ok.ru/"
    );

    normalized = normalized.replace(
        /\.(mp4|m3u8)\/(?=([?#].*)?$)/i,
        ".$1"
    );

    return normalized;
}

function extractEpisodeNumber(title, fallbackIndex = 0) {
    const text = cleanTitle(title);

    const match =
        text.match(/\bEP(?:ISODE)?[.\s_-]*0*(\d+)/i) ||
        text.match(/\b0*(\d+)\s*(?:E|END)\b/i) ||
        text.match(/\b0*(\d+)\b/);

    if (!match?.[1]) {
        return fallbackIndex + 1;
    }

    const episode = Number.parseInt(match[1], 10);

    return Number.isInteger(episode) && episode > 0
        ? episode
        : fallbackIndex + 1;
}

function normalizeEpisodeTitle(title, index) {
    const original = cleanTitle(title);
    const episode = extractEpisodeNumber(original, index);

    const isEnd =
        /\bEND\b/i.test(original) ||
        new RegExp(
            `EP(?:ISODE)?[.\\s_-]*0*${episode}\\s*E\\b`,
            "i"
        ).test(original);

    return isEnd
        ? `Episode ${episode} End`
        : `Episode ${episode}`;
}

function decodeJavaScriptString(value) {
    return String(value || "")
        .replace(/\\u0026/gi, "&")
        .replace(/\\\//g, "/")
        .replace(/\\"/g, "\"")
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, "\\")
        .trim();
}

/* =========================
   REQUEST HELPER
========================= */

async function fetchPage(url, referer = DEFAULT_BASE_URL) {
    let lastError = null;

    for (let attempt = 1; attempt <= REQUEST_RETRIES; attempt++) {
        try {
            const { data } = await axiosClient.get(url, {
                headers: {
                    ...PAGE_HEADERS,
                    Referer: referer
                },
                validateStatus: status =>
                    status >= 200 && status < 400
            });

            const html = String(data || "");

            if (html && !isBlockedPage(html)) {
                return html;
            }

            console.log(
                `[thekomsan] blocked page, attempt ${attempt}/${REQUEST_RETRIES}`
            );
        } catch (err) {
            lastError = err;

            console.log(
                `[thekomsan] request attempt ${attempt}/${REQUEST_RETRIES} failed:`,
                err?.response?.status || err.message
            );
        }

        if (attempt < REQUEST_RETRIES) {
            await sleep(RETRY_DELAY * attempt);
        }
    }

    if (lastError?.response?.status === 429) {
        console.log(
            "[thekomsan] rate-limited by Blogger/Google"
        );
    }

    return "";
}

/* =========================
   BLOGGER PAGINATION
========================= */

function getNextPageUrl(base, html) {
    const content = String(html || "");

    if (!content || isBlockedPage(content)) {
        return null;
    }

    const $ = cheerio.load(content);

    const cleanBase = String(base || DEFAULT_BASE_URL)
        .replace(/\/$/, "");

    const hrefCandidates = [
        $("a.blog-pager-older-link").first().attr("href"),
        $("#Blog1_blog-pager-older-link").attr("href"),
        $(".blog-pager-older-link").first().attr("href"),
        $('a[rel="next"]').first().attr("href")
    ];

    for (const candidate of hrefCandidates) {
        const nextUrl = absolutizeUrl(candidate, cleanBase);

        if (nextUrl) {
            return nextUrl;
        }
    }

    const loadMore = $("#blog-pager .load-more").first();

    const dataCandidates = [
        loadMore.attr("data-load"),
        loadMore.attr("data-url"),
        loadMore.attr("data-href"),
        loadMore.attr("data-next"),
        loadMore.attr("data-page"),
        loadMore.attr("data-link")
    ];

    for (const candidate of dataCandidates) {
        const nextUrl = absolutizeUrl(candidate, cleanBase);

        if (nextUrl) {
            return nextUrl;
        }
    }

    const scriptPatterns = [
        /["'](https?:\/\/[^"']+\/search\?updated-max=[^"']+)["']/i,
        /["'](\/search\?updated-max=[^"']+)["']/i,
        /(?:nextPage|nextUrl|olderPage|blogPager)\s*[:=]\s*["']([^"']+)["']/i
    ];

    for (const pattern of scriptPatterns) {
        const match = content.match(pattern);

        if (!match?.[1]) continue;

        const nextUrl = absolutizeUrl(
            match[1].replace(/&amp;/gi, "&"),
            cleanBase
        );

        if (nextUrl) {
            return nextUrl;
        }
    }

    const articles = $("article.blog-post").toArray();

    if (!articles.length) {
        return null;
    }

    const lastArticle = $(articles[articles.length - 1]);

    const published =
        lastArticle
            .find('meta[itemprop="datePublished"]')
            .attr("content") ||
        lastArticle
            .find("time[datetime]")
            .attr("datetime") ||
        lastArticle
            .find(".published")
            .attr("datetime") ||
        lastArticle
            .find('[itemprop="datePublished"]')
            .attr("content") ||
        "";

    if (!published) {
        return null;
    }

    return (
        `${cleanBase}/search?updated-max=` +
        `${encodeURIComponent(published)}&max-results=20`
    );
}

/* =========================
   PLAYLIST PARSER
========================= */

function extractPlaylistArray(html) {
    const content = String(html || "");

    const patterns = [
        /(?:const|let|var)\s+videos\s*=\s*(\[[\s\S]*?\])\s*;/i,
        /options\.player_list\s*=\s*(\[[\s\S]*?\])\s*;/i,
        /(?:const|let|var)\s+playlist\s*=\s*(\[[\s\S]*?\])\s*;/i
    ];

    for (const pattern of patterns) {
        const match = content.match(pattern);

        if (match?.[1]) {
            return match[1];
        }
    }

    return "";
}

function parsePlaylistObject(objectText, index, baseUrl) {
    const titleMatch = objectText.match(
        /(?:["']?title["']?)\s*:\s*(["'])([\s\S]*?)\1/i
    );

    const fileMatch = objectText.match(
        /(?:["']?(?:file|src|url)["']?)\s*:\s*(["'])([\s\S]*?)\1/i
    );

    if (!fileMatch?.[2]) {
        return null;
    }

    const rawTitle =
        titleMatch?.[2] ||
        `Episode ${index + 1}`;

    const rawFile = fileMatch[2];

    const file = normalizeVideoUrl(
        decodeJavaScriptString(rawFile),
        baseUrl
    );

    if (!file) {
        return null;
    }

    return {
        title: normalizeEpisodeTitle(
            decodeJavaScriptString(rawTitle),
            index
        ),
        file
    };
}

function parseVideosArray(html, baseUrl = DEFAULT_BASE_URL) {
    try {
        const rawArray = extractPlaylistArray(html);

        if (!rawArray) {
            return [];
        }

        const objects =
            rawArray.match(/\{[\s\S]*?\}/g) || [];

        return objects
            .map((objectText, index) =>
                parsePlaylistObject(
                    objectText,
                    index,
                    baseUrl
                )
            )
            .filter(Boolean);
    } catch (err) {
        console.log(
            "[thekomsan] parseVideosArray failed:",
            err.message
        );

        return [];
    }
}

/* =========================
   PAGE DETAIL CACHE
========================= */

function getCachedPageDetail(url) {
    const cached = PAGE_DETAIL_CACHE.get(url);

    if (!cached) {
        return null;
    }

    if (Date.now() - cached.time > PAGE_CACHE_TTL) {
        PAGE_DETAIL_CACHE.delete(url);
        return null;
    }

    return cached.detail;
}

function setCachedPageDetail(url, detail) {
    PAGE_DETAIL_CACHE.set(url, {
        time: Date.now(),
        detail
    });
}

/* =========================
   PAGE DETAIL
========================= */

async function getPageDetail(url) {
    const cached = getCachedPageDetail(url);

    if (cached) {
        return cached;
    }

    try {
        const html = await fetchPage(
            url,
            `${DEFAULT_BASE_URL}/`
        );

        if (!html) {
            return null;
        }

        const $ = cheerio.load(html);

        const title =
            cleanTitle(
                $("h1.entry-title").first().text()
            ) ||
            cleanTitle(
                $('meta[property="og:title"]')
                    .attr("content")
            ) ||
            cleanTitle(
                $("title").first().text()
            );

        let thumbnail =
            $('meta[property="og:image"]').attr("content") ||
            $('meta[name="twitter:image"]').attr("content") ||
            $("#my-poster img").first().attr("data-src") ||
            $("#my-poster img").first().attr("src") ||
            $("#postimg img").first().attr("src") ||
            $("meta[itemprop='image']").attr("content") ||
            "";

        thumbnail = normalizeTheKomsanPoster(
            absolutizeUrl(thumbnail, url)
        );

        const videos = parseVideosArray(
            html,
            url
        );

        if (!videos.length) {
            return null;
        }

        const detail = {
            title,
            thumbnail,
            videos
        };

        setCachedPageDetail(
            url,
            detail
        );

        return detail;
    } catch (err) {
        console.log(
            "[thekomsan] getPageDetail failed:",
            err.message
        );

        return null;
    }
}

/* =========================
   CATALOG
========================= */

async function getCatalogItems(prefix, siteConfig, url) {
    try {
        const baseUrl =
            siteConfig?.baseUrl ||
            DEFAULT_BASE_URL;

        const requestUrl = absolutizeUrl(
            url,
            baseUrl
        );

        if (!requestUrl) {
            return [];
        }

        const html = await fetchPage(
            requestUrl,
            `${String(baseUrl).replace(/\/$/, "")}/`
        );

        if (!html) {
            return [];
        }

        const $ = cheerio.load(html);

        let posts = $(
            "div.blog-posts div.grid-posts article.blog-post"
        ).toArray();

        if (!posts.length) {
            posts = $(
                "article.blog-post"
            ).toArray();
        }

        const results = posts.map(post => {
            const $post = $(post);

            const imageLink = $post
                .find(
                    "div.post-filter-image a.post-filter-link[href]"
                )
                .first();

            const titleLink = $post
                .find(
                    "h2.entry-title a[href]"
                )
                .first();

            const anchor = imageLink.length
                ? imageLink
                : titleLink;

            const title =
                cleanTitle(
                    anchor.attr("title")
                ) ||
                cleanTitle(
                    titleLink.text()
                ) ||
                cleanTitle(
                    anchor.text()
                );

            const rawLink =
                anchor.attr("href") ||
                titleLink.attr("href") ||
                "";

            const link = absolutizeUrl(
                rawLink,
                baseUrl
            );

            if (
                !title ||
                !link ||
                !isValidTheKomsanPostUrl(link)
            ) {
                return null;
            }

            const image = $post
                .find("img.snip-thumbnail")
                .first();

            let poster =
                image.attr("data-src") ||
                image.attr("data-original") ||
                image.attr("src") ||
                anchor
                    .find("img")
                    .first()
                    .attr("data-src") ||
                anchor
                    .find("img")
                    .first()
                    .attr("src") ||
                "";

            poster = normalizeTheKomsanPoster(
                absolutizeUrl(
                    poster,
                    requestUrl
                )
            );

            return {
                id: `${prefix}:${encodeURIComponent(link)}`,
                name: title,
                poster,
                background: poster
            };
        });

        return uniqById(
            results.filter(Boolean)
        );
    } catch (err) {
        console.log(
            "[thekomsan] getCatalogItems failed:",
            err.message
        );

        return [];
    }
}

/* =========================
   EPISODES
========================= */

async function getEpisodes(prefix, seriesUrl) {
    try {
        const detail = await getPageDetail(
            seriesUrl
        );

        if (!detail?.videos?.length) {
            return [];
        }

        return detail.videos.map(
            (video, index) => {
                const episodeNumber =
                    extractEpisodeNumber(
                        video.title,
                        index
                    );

                return {
                    id:
                        `${prefix}:${encodeURIComponent(seriesUrl)}` +
                        `:1:${episodeNumber}`,
                    title: video.title,
                    seriesTitle: detail.title,
                    season: 1,
                    episode: episodeNumber,
                    thumbnail:
                        detail.thumbnail || "",
                    released:
                        new Date().toISOString()
                };
            }
        );
    } catch (err) {
        console.log(
            "[thekomsan] getEpisodes failed:",
            err.message
        );

        return [];
    }
}

/* =========================
   STREAM
========================= */

async function getStream(prefix, seriesUrl, episode) {
    try {
        const detail = await getPageDetail(
            seriesUrl
        );

        if (!detail?.videos?.length) {
            return null;
        }

        const video =
            detail.videos.find(
                (item, index) =>
                    extractEpisodeNumber(
                        item.title,
                        index
                    ) === episode
            ) ||
            detail.videos[episode - 1];

        if (!video?.file) {
            return null;
        }

        const streamTitle =
            video.title ||
            `Episode ${episode}`;

        let url = normalizeVideoUrl(
            video.file,
            seriesUrl
        );

        if (!url) {
            return null;
        }

        /* YouTube */

        if (/youtu\.be|youtube\.com/i.test(url)) {
            return buildYouTubeStreams(
                url,
                episode,
                streamTitle,
                SITE_NAME,
                GROUP_NAME
            );
        }

        /* Phumi player.php */

        if (/player\.php/i.test(url)) {
            const resolved =
                await resolvePlayerUrl(url);

            if (!resolved) {
                return null;
            }

            url = normalizeVideoUrl(
                resolved,
                seriesUrl
            );
        }

        /* ScreenPal */

        if (/screenpal\.com/i.test(url)) {
            const resolved =
                await resolveScreenPal(url);

            if (resolved) {
                url = normalizeVideoUrl(
                    resolved,
                    seriesUrl
                );
            }
        }

        /* OK.ru */

        if (
            /ok\.ru\/(?:videoembed|video)\//i.test(url)
        ) {
            const embedUrl = url
                .replace(
                    "/video/",
                    "/videoembed/"
                )
                .replace(
                    /[?&]autoplay=1\b/gi,
                    ""
                )
                .replace(
                    /[?&]autoplay=true\b/gi,
                    ""
                )
                .replace(/\?$/, "");

            const resolved =
                await resolveOkEmbed(embedUrl);

            url = resolved || embedUrl;
        }

        url = normalizeVideoUrl(
            url,
            seriesUrl
        );

        if (!url) {
            return null;
        }

        return buildStream(
            url,
            episode,
            streamTitle,
            SITE_NAME,
            GROUP_NAME,
            seriesUrl
        );
    } catch (err) {
        console.log(
            "[thekomsan] getStream failed:",
            err.message
        );

        return null;
    }
}

module.exports = {
    getCatalogItems,
    getEpisodes,
    getStream,
    getNextPageUrl
};
