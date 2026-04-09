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
    posterAttrs: ["data-src", "data-bsrjs"],
	genreUrls: {
      Thai: "https://phumikhmer.vip/category/thai-drama/",
      China: "https://phumikhmer.vip/category/chinese-drama/",
      Korean: "https://phumikhmer.vip/category/korean-drama/"
	}
  },

  sunday: {
    ...defaultSite,
    baseUrl: "https://www.sundaydrama.com",
    articleSelector: "div.blog-posts div.entry-inner",
    titleSelector: "a.entry-image-wrap",
    posterSelector: "a.entry-image-wrap span, a.entry-image-wrap img",
    posterAttrs: ["data-src", "src"],
	genreUrls: {
      Thai: "https://www.sundaydrama.com/search/label/Thai%20Drama?&max-results=30",
      China: "https://www.sundaydrama.com/search/label/Chinese%20Drama?&max-results=30",
      Korean: "https://www.sundaydrama.com/search/label/Korean%20Drama?&max-results=30"
	}	
  },
  
  phumi2: {
	pageSize: 12, 
    baseUrl: "https://www.phumikhmer1.club/",
    genreUrls: {
      Khmer: "https://www.phumikhmer1.club/search/label/Khmer?&max-results=24",
      China: "https://www.phumikhmer1.club/search/label/Chinese?&max-results=24",
      Korean: "https://www.phumikhmer1.club/search/label/Korea?&max-results=24"
    }	
  },  

  khmerave: {
    ...albumSite,
    baseUrl: "https://www.khmeravenue.com/album/",
    genreUrls: {
      Modern: "https://www.khmeravenue.com/genre/modern/",
      China: "https://www.khmeravenue.com/genre/ancient/",
      Korean: "https://www.khmeravenue.com/country/korea/"
    }
  },

  merlkon: {
    ...albumSite,
    baseUrl: "https://www.khmerdrama.com/album/",
    genreUrls: {
      Khmer: "https://www.khmerdrama.com/country/cambodia/",
      Thai: "https://www.khmerdrama.com/country/thailand/",
      Indian: "https://www.khmerdrama.com/country/india/"
    }
  },

  idrama: {
    ...defaultSite,
    baseUrl: "https://www.idramahd.com",
    articleSelector: "article.hitmag-post",
    titleSelector: "h3.entry-title a",
    posterSelector: ".archive-thumb img",
    posterAttrs: ["data-src", "src"],
	genreUrls: {
      Thai: "https://www.idramahd.com/thai-drama/",
      China: "https://www.idramahd.com/chinese-drama/",
      Korean: "https://www.idramahd.com/korean-drama/"
	}
  },
  
  cat3movie: {
    ...defaultSite,
    baseUrl: "https://www.cat3movie.club/",
    pageSize: 40,
  },

  xvideos: {
    ...defaultSite,
    baseUrl: "https://www.xvideos.com",
    pageSize: 27,
  },  

  khmertv: {
	pageSize: 8,  
    baseUrl: ""
  },  
  
}; 