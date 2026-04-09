module.exports = (builder, deps) => {
  const { getSiteEngine, SITE_TYPES } = deps;

  /* =========================
     STREAM
  ========================= */
  builder.defineStreamHandler(async ({ id }) => {
    try {
      const parts = id.split(":");
      const prefix = parts[0];
      const encodedUrl = parts[1];

      if (!prefix || !encodedUrl) {
        return { streams: [] };
      }

      const siteType = SITE_TYPES[prefix] || SITE_TYPES.default;
      const isSingleItem = siteType === "movie" || siteType === "channel";
      const epNum = isSingleItem ? 1 : Number(parts[parts.length - 1]);

      if (!isSingleItem && (!Number.isInteger(epNum) || epNum <= 0)) {
        return { streams: [] };
      }

      const ctx = getSiteEngine(prefix);
      if (!ctx) return { streams: [] };

      const { engine: siteEngine } = ctx;
      const seriesUrl = decodeURIComponent(encodedUrl);

      const stream = await siteEngine.getStream(prefix, seriesUrl, epNum);
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