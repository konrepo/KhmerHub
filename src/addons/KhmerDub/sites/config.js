const defaultSite = {
  pageSize: 30
};

const albumSite = {
  pageSize: 18
};

module.exports = {
  vip: {
    ...defaultSite,
    baseUrl: "https://phumikhmer.vip",
    articleSelector: "article",
    titleSelector: "h2 a, h3 a",
    posterSelector: "a.img-holder",
    posterAttrs: ["data-src", "data-bsrjs"]
  },

  sunday: {
    ...defaultSite,
    baseUrl: "https://www.sundaydrama.com",
    articleSelector: "div.blog-posts div.entry-inner",
    titleSelector: "a.entry-image-wrap",
    posterSelector: "a.entry-image-wrap span, a.entry-image-wrap img",
    posterAttrs: ["data-src", "src"]
  },
  
  phumi2: {
	pageSize: 12, 
    baseUrl: "https://www.phumikhmer1.club/"
  },  

  khmerave: {
    ...albumSite,
    baseUrl: "https://www.khmeravenue.com/album/"
  },

  merlkon: {
    ...albumSite,
    baseUrl: "https://www.khmerdrama.com/album/"
  },

  idrama: {
    ...defaultSite,
    baseUrl: "https://www.idramahd.com",
    articleSelector: "article.hitmag-post",
    titleSelector: "h3.entry-title a",
    posterSelector: ".archive-thumb img",
    posterAttrs: ["data-src", "src"]
  }
  
};