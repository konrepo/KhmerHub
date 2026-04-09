const axiosClient = require("./fetch");

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
        return altMatches[altMatches.length - 1][1]
          .replace(/\\u0026/g, "&")
          .replace(/\\&/g, "&")
          .replace(/\\\//g, "/")
          .replace(/&amp;/g, "&");
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

          console.log("[resolveOkEmbed] metadata final", cleanUrl);
        }
      } catch {}
    }

    cleanUrl = cleanUrl
      .replace(/\\u0026/g, "&")
      .replace(/\\&/g, "&")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    console.log("[resolveOkEmbed] final", cleanUrl);

    return cleanUrl;
  } catch {
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
  buildStream

};