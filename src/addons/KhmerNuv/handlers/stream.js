module.exports = (builder, deps) => {
  const { getSiteEngine, SITE_TYPES } = deps;
  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(...args);

  /* =========================
     STREAM
  ========================= */
  builder.defineStreamHandler(async ({ id }) => {
    try {
      log("[STREAM] handler called", { id });

      const parts = id.split(":");
      const prefix = parts[0];

      if (!prefix || parts.length < 2) {
        log("[STREAM] invalid id format");
        return { streams: [] };
      }

      const siteType = SITE_TYPES[prefix] || SITE_TYPES.default;
      const isSingleItem = siteType === "movie" || siteType === "channel";

      let encodedUrl;
      let epNum;

      if (isSingleItem) {
        encodedUrl = parts.slice(1).join(":");
        epNum = 1;
      } else {
        encodedUrl = parts[1];
        epNum = Number(parts[parts.length - 1]);
      }

      log("[STREAM] parsed", {
        prefix,
        siteType,
        isSingleItem,
        encodedUrl,
        epNum
      });

      if (!encodedUrl) {
        log("[STREAM] missing encodedUrl");
        return { streams: [] };
      }

      if (!isSingleItem && (!Number.isInteger(epNum) || epNum <= 0)) {
        log("[STREAM] invalid episode number");
        return { streams: [] };
      }

      const ctx = getSiteEngine(prefix);
      if (!ctx) {
        log("[STREAM] no site engine for prefix", prefix);
        return { streams: [] };
      }

      const { engine: siteEngine } = ctx;
      const seriesUrl = decodeURIComponent(encodedUrl);

      log("[STREAM] decoded url", { seriesUrl });

      const stream = await siteEngine.getStream(prefix, seriesUrl, epNum);

      log("[STREAM] getStream result", {
        hasStream: !!stream,
        isArray: Array.isArray(stream),
        count: Array.isArray(stream) ? stream.length : stream ? 1 : 0
      });

      if (!stream) return { streams: [] };

      return {
        streams: Array.isArray(stream) ? stream : [stream]
      };
    } catch (err) {
      console.error("[defineStreamHandler]", err);
      return { streams: [] };
    }
  });
};