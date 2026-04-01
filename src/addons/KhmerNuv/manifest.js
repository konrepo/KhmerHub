const EXTRA = ["search", "skip"];

const sites = [
  { id: "vip", name: "PhumiVip" },
  { id: "sunday", name: "SundayDrama" },
  { id: "phumi2", name: "PhumiClub" },  
  { id: "khmerave", name: "KhmerAve" },
  { id: "merlkon", name: "Merlkon" },
  { id: "idrama", name: "iDramaHD" },
  { id: "cat3movie", name: "Cat3Movie", type: "movie" }  
];

module.exports = {
  id: "community.khmer.nuvio",
  version: "4.1.0",
  name: "KhmerNuv",
  description: "Stream Asian dramas dubbed in Khmer (Nuvio App) | By: TheDevilz.",
  logo: "https://avatars.githubusercontent.com/u/32822347?v=4",

  resources: ["catalog", "meta", "stream"],
  types: ["series", "movie"],
  idPrefixes: sites.map((s) => s.id),

  catalogs: sites.map((site) => ({
    type: site.type,
    id: site.id,
    name: site.name,
    extraSupported: EXTRA
  })),

  behaviorHints: {
    configurable: false
  }
};