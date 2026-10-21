const axiosClient = require("./fetch");

/* =========================
   YOUTUBE HELPERS
========================= */
function extractYouTubeId(url = "") {
  const u = String(url).trim();

  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{11})/i,
    /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/i,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/i
  ];

  for (const re of patterns) {
    const m = u.match(re);
    if (m?.[1]) return m[1];
  }

  return null;
}

function buildYouTubeStreams(
  url,
  episode,
  title,
  name = "KhmerDub",
  group = "khmerdub"
) {
  const ytId = extractYouTubeId(url);
  if (!ytId) return null;

  const streamTitle = title || `Episode ${episode}`;

  return [
    {
      ytId,
      name,
      title: streamTitle,
      behaviorHints: { group }
    },
    {
      externalUrl: `https://www.youtube.com/watch?v=${ytId}`,
      name: `${name} YouTube`,
      title: streamTitle,
      behaviorHints: {
        group,
        notWebReady: true
      }
    }
  ];
}

/* =========================
   PLAYER RESOLVE
========================= */
async function resolvePlayerUrl(playerUrl) {
  try {
    const { data } = await axiosClient.get(playerUrl);

    const html = data
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    const match = html.match(
      /https?:\/\/phumikhmer\.vip\/player\.php\?stream=[^"'<> ]+/i
    );

    return match ? match[0] : null;
  } catch {
    return null;
  }
}

async function pickHighestHlsVariant(masterUrl) {
  try {
    const { data } = await axiosClient.get(masterUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://ok.ru/"
      }
    });

    const lines = String(data || "").split(/\r?\n/);
    let best = null;

    for (let i = 0; i < lines.length; i++) {
      const info = lines[i];
      if (!info.startsWith("#EXT-X-STREAM-INF")) continue;

      const next = lines[i + 1];
      if (!next || next.startsWith("#")) continue;

      const res = info.match(/RESOLUTION=(\d+)x(\d+)/i);
      const height = res ? parseInt(res[2], 10) : 0;

      let variantUrl;
      try {
        variantUrl = new URL(next.trim(), masterUrl).toString();
      } catch {
        continue;
      }

      if (!best || height > best.height) {
        best = { height, url: variantUrl };
      }
    }

    return best?.url || masterUrl;
  } catch {
    return masterUrl;
  }
}

/* =========================
   RESOLVE OK
========================= */
async function resolveOkEmbed(embedUrl) {
  try {
    const { data } = await axiosClient.get(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://ok.ru/"
      }
    });

    let html = typeof data === "string" ? data : JSON.stringify(data);

    html = html
      .replace(/\\u0026/g, "&")
      .replace(/\\&/g, "&")
      .replace(/\\\//g, "/")
      .replace(/\\&quot;/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");

    const patterns = [
      /"hlsMasterPlaylistUrl":"(https:[^"]+?\.m3u8[^"]*)"/i,
      /"ondemandHls":"(https:[^"]+?\.m3u8[^"]*)"/i,
      /"hlsManifestUrl":"(https:[^"]+?\.m3u8[^"]*)"/i,
      /"metadataUrl":"(https:[^"]+)"/i,
      /"videoSrc":"(https:[^"]+?\.m3u8[^"]*)"/i,
      /"(https:\/\/[^"]+master\.m3u8[^"]*)"/i,
      /"(https:\/\/[^"]+\.m3u8[^"]*)"/i
    ];

    let match = null;

    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]) {
        match = m;
        break;
      }
    }

    if (!match?.[1]) {
      const altMatches = [
        ...html.matchAll(/"name":"[^"]+","url":"(https:[^"]+)"/gi),
        ...html.matchAll(/"url":"(https:[^"]+)","name":"[^"]+"/gi)
      ];

      if (altMatches.length) {
        const okruUrl = altMatches[altMatches.length - 1][1]
          .replace(/\\u0026/g, "&")
          .replace(/\\&/g, "&")
          .replace(/\\\//g, "/")
          .replace(/&amp;/g, "&");

        return await pickHighestHlsVariant(okruUrl);
      }
      return null;
    }

    let cleanUrl = match[1]
      .replace(/\\u0026/g, "&")
      .replace(/\\&/g, "&")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    if (/metadata/i.test(cleanUrl) && /^https?:\/\//i.test(cleanUrl)) {
      try {
        const { data: metaData } = await axiosClient.get(cleanUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Referer: "https://ok.ru/"
          }
        });

        let metaText = typeof metaData === "string"
          ? metaData
          : JSON.stringify(metaData);

        metaText = metaText
          .replace(/\\u0026/g, "&")
          .replace(/\\&/g, "&")
          .replace(/\\\//g, "/")
          .replace(/&amp;/g, "&");

        const metaMatch =
          metaText.match(/"ondemandHls"\s*:\s*"([^"]+)"/i) ||
          metaText.match(/"hlsMasterPlaylistUrl"\s*:\s*"([^"]+)"/i) ||
          metaText.match(/"hlsManifestUrl"\s*:\s*"([^"]+)"/i) ||
          metaText.match(/"videoSrc"\s*:\s*"([^"]+\.m3u8[^"]*)"/i) ||
          metaText.match(/"(https:\/\/[^"]+\.m3u8[^"]*)"/i);

        if (metaMatch?.[1]) {
          cleanUrl = metaMatch[1]
            .replace(/\\u0026/g, "&")
            .replace(/\\&/g, "&")
            .replace(/\\\//g, "/")
            .replace(/&amp;/g, "&");
        }
      } catch {}
    }

    cleanUrl = cleanUrl
      .replace(/\\u0026/g, "&")
      .replace(/\\&/g, "&")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    return await pickHighestHlsVariant(cleanUrl);
  } catch {
    return null;
  }
}

async function resolveScreenPal(url) {
  const match =
    url.match(/go\.screenpal\.com\/watch\/([A-Za-z0-9]+)/i) ||
    url.match(/go\.screenpal\.com\/player\/([A-Za-z0-9]+)/i);

  if (!match) return null;

  return `https://go.screenpal.com/player/stream/${match[1]}`;
}

/* =========================
   NIZU JW PLAYER RESOLVE
========================= */
async function resolveNizuEmbed(embedUrl) {
  try {
    const parsed = new URL(embedUrl);
    if (!/^s\d+\.nizu\.top$/i.test(parsed.hostname)) return null;

    const { data } = await axiosClient.get(parsed.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://luly.top/"
      }
    });

    const html = String(data || "");
    const match = html.match(/\b(?:var|let|const)\s+videoSources\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!match) return null;

    const sources = JSON.parse(match[1].replace(/\\:/g, ":"));
    const playable = sources
      .filter((source) => source && typeof source.file === "string")
      .sort((a, b) => (parseInt(b.label, 10) || 0) - (parseInt(a.label, 10) || 0));

    for (const source of playable) {
      const url = new URL(source.file.replace(/\\\//g, "/"), parsed);
      if (!/^https?:$/.test(url.protocol)) continue;
      // Never send a player page to the media demuxer.
      if (url.searchParams.has("stream") || /\.(?:mp4|m3u8)(?:$|\?)/i.test(url.toString())) {
        return url.toString();
      }
    }
    return null;
  } catch (error) {
    console.warn("[VIP Nizu resolve failed]", error.message);
    return null;
  }
}

/* =========================
   BUILD STREAM
========================= */
function buildStream(
  url,
  episode,
  title,
  name = "KhmerDub",
  group = "khmerdub",
  referer = null
) {
  const isOk = /ok\.ru|okcdn\.ru/i.test(url);

  return {
    url,
    name,
    title: title || `Episode ${episode}`,
    type: url.includes(".m3u8") ? "hls" : undefined,
    behaviorHints: isOk
      ? {
          group,
          notWebReady: true,
          proxyHeaders: {
            request: {
              Referer: "https://ok.ru/",
              Origin: "https://ok.ru",
              "User-Agent": "Mozilla/5.0"
            }
          }
        }
      : referer
        ? {
            group,
            notWebReady: true,
            proxyHeaders: {
              request: {
                Referer: referer,
                "User-Agent": "Mozilla/5.0"
              }
            }
          }
        : { group }
  };
}

module.exports = {
  resolvePlayerUrl,
  resolveOkEmbed,
  resolveNizuEmbed,
  resolveScreenPal,
  buildStream,
  extractYouTubeId,
  buildYouTubeStreams
};
