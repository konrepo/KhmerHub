module.exports = (builder, deps) => {
  const {
    getSiteEngine,
    SITE_TYPES,
    axiosClient,
    cheerio,
    normalizePoster,
    mapMetas,
    uniqById,
    URL_TO_POSTID,
    POST_INFO
  } = deps;

  /* =========================
     CATALOG
  ========================= */
  builder.defineCatalogHandler(async ({ id, extra }) => {
    try {
      const ctx = getSiteEngine(id);
      if (!ctx) return { metas: [] };

      const { site, engine: siteEngine } = ctx;
      
	  // VIP / iDrama
      if ((id === "vip" || id === "idrama") && extra?.genre) {
        const baseGenreUrl = site.genreUrls?.[extra.genre];
        if (!baseGenreUrl) return { metas: [] };

        const pageSize = site.pageSize || 30;
        const skip = Number(extra?.skip || 0);
        const page = Math.floor(skip / pageSize) + 1;

        const genreBase = String(baseGenreUrl).replace(/\/$/, "");
        const url = page === 1
          ? `${genreBase}/`
          : `${genreBase}/page/${page}/`;

        const items = await siteEngine.getCatalogItems(id, site, url);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(items, type) };
      }

      // KhmetTv
      if (id === "khmertv" || id === "english") {
        const skip = Number(extra?.skip || 0);
        if (skip > 0) return { metas: [] };

        const items = await siteEngine.getCatalogItems(id, site, "");
        return { metas: mapMetas(items, "channel") };
      }
	  
	  // KhmerAve / Merlkon
      if ((id === "khmerave" || id === "merlkon") && extra?.genre) {
        const baseGenreUrl = site.genreUrls?.[extra.genre];
        if (!baseGenreUrl) return { metas: [] };

        const WEBSITE_PAGE_SIZE = site.pageSize || 18;
        const PAGES_PER_BATCH = 3;

        const skip = Number(extra?.skip || 0);
        const startPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        const genreBase = String(baseGenreUrl).replace(/\/$/, "");
        const pages = [];

        for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
          const url = p === 1
            ? `${genreBase}/`
            : `${genreBase}/page/${p}/`;

          pages.push(siteEngine.getCatalogItems(id, site, url));
        }

        const results = await Promise.all(pages);
        const allItems = results.flat();
        const uniq = uniqById(allItems);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(uniq, type) };
      }	  
	  
      if (extra?.search && (id === "khmerave" || id === "merlkon")) {
        const keyword = encodeURIComponent(extra.search);

        const url = id === "merlkon"
          ? `https://www.khmerdrama.com/?s=${keyword}`
          : `https://www.khmeravenue.com/?s=${keyword}`;

        const items = await siteEngine.getCatalogItems(id, site, url);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(items, type) };
      }

      if (id === "khmerave" || id === "merlkon") {
        const WEBSITE_PAGE_SIZE = site.pageSize || 18;
        const PAGES_PER_BATCH = 3;

        const skip = Number(extra?.skip || 0);
        const startPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const pages = [];

        for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
          const url = p === 1
            ? `${base}/`
            : `${base}/page/${p}/`;

          pages.push(siteEngine.getCatalogItems(id, site, url));
        }

        const results = await Promise.all(pages);
        const allItems = results.flat();
        const uniq = uniqById(allItems);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(uniq, type) };
      }
	  
      // SundayDrama - Blogger JSON feed
      if (id === "sunday") {
        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const pageSize = site.pageSize || 30;
        const skip = Math.max(0, Number(extra?.skip || 0));
        const startIndex = skip + 1;

        const genreLabels = {
          Thai: "Thai Drama",
          China: "Chinese Drama",
          Korean: "Korean Drama"
        };

        let feedUrl;

        if (extra?.genre) {
          const label = genreLabels[extra.genre];
          if (!label) return { metas: [] };

          feedUrl =
            `${base}/feeds/posts/default/-/${encodeURIComponent(label)}` +
            `?alt=json&max-results=${pageSize}&start-index=${startIndex}`;
        } else if (extra?.search) {
          feedUrl =
            `${base}/feeds/posts/default` +
            `?alt=json&q=${encodeURIComponent(extra.search)}` +
            `&max-results=${pageSize}&start-index=${startIndex}`;
        } else {
          feedUrl =
            `${base}/feeds/posts/default` +
            `?alt=json&max-results=${pageSize}&start-index=${startIndex}`;
        }

        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          Referer: `${base}/`
        };

        const { data } = await axiosClient.get(feedUrl, {
          headers,
          maxRedirects: 0,
          validateStatus: status => status >= 200 && status < 400
        });

        const entries = data?.feed?.entry || [];

        const items = entries
          .map((entry) => {
            const title = String(entry?.title?.$t || "").trim();

            const link =
              entry?.link?.find(item => item.rel === "alternate")?.href ||
              "";

            const postHtml =
              entry?.content?.$t ||
              entry?.summary?.$t ||
              "";

            const $post = cheerio.load(postHtml);

            const playerPostId =
              $post("#fanta[data-post-id]").first().attr("data-post-id") ||
              "";

            const poster =
              entry?.media$thumbnail?.url ||
              postHtml.match(
                /<img[^>]+(?:data-src|src)=["']([^"']+)/i
              )?.[1] ||
              "";

            if (!title || !link) return null;

            if (playerPostId) {
              URL_TO_POSTID.set(link, playerPostId);

              POST_INFO.set(playerPostId, {
                ...(POST_INFO.get(playerPostId) || {}),
                sourceType: "blogger",
                cleanTitle: title,
                pageHtml: postHtml
              });
            }

            const normalizedPoster = normalizePoster(poster);

            return {
              id: `sunday:${encodeURIComponent(link)}`,
              name: title,
              poster: normalizedPoster,
              background: normalizedPoster
            };
          })
          .filter(Boolean);

        const uniq = uniqById(items);
        const type = SITE_TYPES[id] || SITE_TYPES.default;

        return {
          metas: mapMetas(uniq, type)
        };
      }

      // xVideos genre
      if (id === "xvideos" && extra?.genre) {
        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const pageSize = site.pageSize || 27;
        const skip = Number(extra?.skip || 0);
        const page = Math.floor(skip / pageSize) + 1;

        const categoryPath = site.categoryMap?.[extra.genre];
        if (!categoryPath) return { metas: [] };

        const normalizedPath = String(categoryPath).startsWith("http")
          ? String(categoryPath).replace(/\/$/, "")
          : `${base}${String(categoryPath)}`.replace(/\/$/, "");

        const url = page === 1
          ? normalizedPath
          : normalizedPath.includes("?")
            ? `${normalizedPath}&p=${page}`
            : `${normalizedPath}/${page - 1}`;

        const items = await siteEngine.getCatalogItems(id, site, url);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(items, type) };
      }

      // Phumi2
      if (id === "phumi2" && extra?.genre) {
        const startUrl = site.genreUrls?.[extra.genre];
        if (!startUrl) return { metas: [] };

        const WEBSITE_PAGE_SIZE = 24;
        const PAGES_PER_BATCH = 3;

        const skip = Number(extra?.skip || 0);
        const targetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        let url = startUrl;
        let currentPage = 1;
        let allItems = [];

        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          Referer: `${base}/`,
        };

        while (currentPage < targetPage && url) {
          const { data } = await axiosClient.get(url, { headers });
          url = siteEngine.getNextPageUrl(base, data);
          currentPage++;
        }

        for (let i = 0; i < PAGES_PER_BATCH && url; i++) {
          const items = await siteEngine.getCatalogItems(id, site, url);
          allItems.push(...items);

          const { data } = await axiosClient.get(url, { headers });
          url = siteEngine.getNextPageUrl(base, data);
        }

        const uniq = uniqById(allItems);
        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(uniq, type) };
      }	  

      // TheKomsan - Blogger JSON feed
      if (id === "thekomsan") {
        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const pageSize = site.pageSize || 20;
        const skip = Math.max(0, Number(extra?.skip || 0));
        const startIndex = skip + 1;

        const genreLabels = {
          OnAir: "On Air",
          Chinese: "Chinese",
          Korean: "Korean"
        };

        let feedUrl;

        if (extra?.genre) {
          const label = genreLabels[extra.genre];
          if (!label) return { metas: [] };

          feedUrl =
            `${base}/feeds/posts/default/-/${encodeURIComponent(label)}` +
            `?alt=json&max-results=${pageSize}&start-index=${startIndex}`;
        } else if (extra?.search) {
          feedUrl =
            `${base}/feeds/posts/default` +
            `?alt=json&q=${encodeURIComponent(extra.search)}` +
            `&max-results=${pageSize}&start-index=${startIndex}`;
        } else {
          feedUrl =
            `${base}/feeds/posts/default` +
            `?alt=json&max-results=${pageSize}&start-index=${startIndex}`;
        }

        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          Referer: `${base}/`,
        };

        try {
          const { data } = await axiosClient.get(feedUrl, {
            headers,
            maxRedirects: 0,
            validateStatus: status => status >= 200 && status < 400
          });

          const entries = data?.feed?.entry || [];

          const items = entries
            .map((entry) => {
              const title = String(entry?.title?.$t || "").trim();

              const link =
                entry?.link?.find(item => item.rel === "alternate")?.href ||
                "";

              const postHtml =
                entry?.content?.$t ||
                entry?.summary?.$t ||
                "";

              let poster =
                entry?.media$thumbnail?.url ||
                postHtml.match(
                  /<img[^>]+(?:data-src|data-original|src)=["']([^"']+)/i
                )?.[1] ||
                "";

              if (!title || !link) return null;

              poster = normalizePoster(
                poster
                  .replace(/\/s\d+(?:-[a-z0-9-]+)?\//gi, "/s0/")
                  .replace(/\/w\d+-h\d+[^/]*\//gi, "/s0/")
                  .replace(/=s\d+(?:-[a-z0-9-]+)?/gi, "=s0")
                  .replace(/=w\d+-h\d+[^&]*/gi, "=s0")
              );

              return {
                id: `thekomsan:${encodeURIComponent(link)}`,
                name: title,
                poster,
                background: poster
              };
            })
            .filter(Boolean);

          const uniq = uniqById(items);
          const type = SITE_TYPES[id] || SITE_TYPES.default;
          return { metas: mapMetas(uniq, type) };
        } catch (err) {
          console.log(
            "[thekomsan] Blogger feed failed:",
            err?.response?.status || err?.message
          );

          return { metas: [] };
        }
      }
		
      // Video4Khmer
      if (id === "v4khmer") {
        const base = String(site.baseUrl || "").replace(/\/$/, "");

        const startUrl = extra?.genre
          ? site.genreUrls?.[extra.genre]
          : extra?.search
            ? `${base}/?search=${encodeURIComponent(extra.search)}`
            : `${base}/`;

        if (!startUrl) return { metas: [] };

        const WEBSITE_PAGE_SIZE = site.pageSize || 40;
        const PAGES_PER_BATCH = 3;

        const skip = Number(extra?.skip || 0);
        const targetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        let url = startUrl;
        let currentPage = 1;
        let allItems = [];

        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          Referer: `${base}/`,
        };

        while (currentPage < targetPage && url) {
          const { data } = await axiosClient.get(url, { headers });
          url = siteEngine.getNextPageUrl(base, data);
          currentPage++;
        }

        for (let i = 0; i < PAGES_PER_BATCH && url; i++) {
          const items = await siteEngine.getCatalogItems(id, site, url);
          allItems.push(...items);

          const { data } = await axiosClient.get(url, { headers });
          url = siteEngine.getNextPageUrl(base, data);
        }

        const uniq = uniqById(allItems);
        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(uniq, type) };
      }  
	  
	  // phumi2, cat3movie, xviceos
      if (id === "phumi2" || id === "cat3movie" || id === "xvideos") {
        const base = String(site.baseUrl || "").replace(/\/$/, "");

        const startUrl = extra?.search
          ? id === "cat3movie"
            ? `${base}/?s=${encodeURIComponent(extra.search)}`
            : id === "xvideos"
              ? `${base}/?k=${encodeURIComponent(extra.search)}`
              : `${base}/search?q=${encodeURIComponent(extra.search)}&max-results=12`
          : id === "cat3movie"
            ? `${base}/`
            : id === "xvideos"
              ? `${base}/`
              : `${base}/?max-results=12`;

        const WEBSITE_PAGE_SIZE =
          site.pageSize || (id === "cat3movie" ? 40 : id === "xvideos" ? 27 : id === "v4khmer" ? 40 : 12);

        const PAGES_PER_BATCH = 3;

        const skip = Number(extra?.skip || 0);
        const targetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        let url = startUrl;
        let currentPage = 1;
        let allItems = [];

        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          Referer: `${base}/`,
        };

        while (currentPage < targetPage && url) {
          const { data } = await axiosClient.get(url, { headers });
          url = siteEngine.getNextPageUrl(base, data);
          currentPage++;
        }

        for (let i = 0; i < PAGES_PER_BATCH && url; i++) {
          const items = await siteEngine.getCatalogItems(id, site, url);
          allItems.push(...items);

          const { data } = await axiosClient.get(url, { headers });
          url = siteEngine.getNextPageUrl(base, data);
        }

        const uniq = uniqById(allItems);
        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(uniq, type) };
      }

      const pageSize = site.pageSize || 30;
      const skip = Number(extra?.skip || 0);
      const page = Math.floor(skip / pageSize) + 1;

      const base = String(site.baseUrl || "").replace(/\/$/, "");

      const url = extra?.search
        ? `${base}/?s=${encodeURIComponent(extra.search)}`
        : page === 1
          ? `${base}/`
          : `${base}/page/${page}/`;

      const items = await siteEngine.getCatalogItems(id, site, url);

      const type = SITE_TYPES[id] || SITE_TYPES.default;
      return { metas: mapMetas(items, type) };

    } catch (e) {
      console.error("catalog error:", e);
      return { metas: [] };
    }
  });
};
