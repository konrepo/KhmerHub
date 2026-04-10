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
    categoryMap: {
      Amateur: "/c/Amateur-65",
      Anal: "/c/Anal-12",
      Arab: "/c/Arab-159",
      Asian: "/c/Asian_Woman-32",
      ASMR: "/c/ASMR-229",
      Ass: "/c/Ass-14",
      BigAss: "/c/Big_Ass-24",
      BigCock: "/c/Big_Cock-34",
      BigTits: "/c/Big_Tits-23",
      Blonde: "/c/Blonde-20",
      Blowjob: "/c/Blowjob-15",
      Brunette: "/c/Brunette-25",
      CamPorn: "/c/Cam_Porn-58",
	  Cheating: "/tags/cheating",
	  College: "/tags/college-party",
      Creampie: "/c/Creampie-40",
      CuckoldHotwife: "/c/Cuckold-237",
      Cumshot: "/c/Cumshot-18",
	  Deepthroat: "/?k=deepthroat&top",
	  Eighteen: "/tags/18-year-old",
      Fisting: "/c/Fisting-165",
      FuckedUpFamily: "/c/Fucked_Up_Family-81",
      Gangbang: "/c/Gangbang-69",
      Indian: "/c/Indian-89",
      Interracial: "/c/Interracial-27",
	  Japanese: "/tags/japan-porn",
      Latina: "/c/Latina-16",
      Lesbian: "/c/Lesbian-26",
      Lingerie: "/c/Lingerie-83",
      Mature: "/c/Mature-38",
      Milf: "/c/Milf-19",
      Oiled: "/c/Oiled-22",
	  Party: "/tags/girls-party",
      Redhead: "/c/Redhead-31",
      Solo: "/c/Solo_and_Masturbation-33",
      Squirting: "/c/Squirting-56",
	  Stepdaughter: "/?k=stepdaughter&top",
      Stockings: "/c/Stockings-28",
	  Swingers: "/tags/swingers",
      Teen: "/c/Teen-13",
	  Threesome: "/tags/threesome",
    }
  },

  khmertv: {
	pageSize: 8,  
    baseUrl: ""
  },  
  
}; 