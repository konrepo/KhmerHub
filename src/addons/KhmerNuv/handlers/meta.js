module.exports = (builder, deps) => {
  const { getSiteEngine, SITE_TYPES } = deps;
  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(...args); 

  /* =========================
     META
  ========================= */
  builder.defineMetaHandler(async ({ id }) => {
    try {
      log("[META] handler called", { id });

      const parts = id.split(":");
      const prefix = parts[0];
      const encodedUrl = parts.slice(1).join(":");

      if (!prefix || !encodedUrl) return { meta: null };

      const ctx = getSiteEngine(prefix);
      if (!ctx) return { meta: null };

      const { engine: siteEngine } = ctx;
      const siteType = SITE_TYPES[prefix] || SITE_TYPES.default;
      const seriesUrl = decodeURIComponent(encodedUrl);

      const episodes = await siteEngine.getEpisodes(prefix, seriesUrl);

      log("[META] episodes", {
        count: episodes?.length || 0,
        firstId: episodes?.[0]?.id
      });

      if (!episodes.length) return { meta: null };

      const first = episodes[0];
      const seriesName = first.seriesTitle || first.name || first.title;      

      /* =========================
         MOVIE / CHANNEL FIX
      ========================= */
      if (siteType === "movie" || siteType === "channel") {
        const canonicalId = first.id;

        log("[META] returning movie meta", {
          incomingId: id,
          metaId: canonicalId
        });

        return {
          meta: {
            id: canonicalId,
            type: siteType,
            name: seriesName,
            poster: first.thumbnail,
            posterShape: "poster",
            background: first.thumbnail,
            description: seriesName,
            genres: first.genres || [],
            available: true,
            videos: [
              {
                id: canonicalId,
                title: first.title,
                thumbnail: first.thumbnail
              }
            ]
          }
        };
      }

      /* =========================
         SERIES
      ========================= */  
      return {
        meta: {
          id,
          type: siteType,
          name: seriesName,
          poster: first.thumbnail,
          posterShape: "poster",
          background: first.thumbnail,
          description: seriesName,
          videos: episodes,
        },
      };

    } catch (err) {
      log("[META] error", err?.message || String(err));
      return { meta: null };
    }
  });
};
