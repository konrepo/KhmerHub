const TYPES = ["series", "movie"];
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
  id: "community.khmer.dubbed",
  version: "3.1.0",
  name: "KhmerDub",
  description: "Stream Asian dramas dubbed in Khmer (Stremio App) | Dev: TheDevilz.",
  logo: "https://avatars.githubusercontent.com/u/32822347?v=4",

  resources: ["catalog", "meta", "stream"],
  types: TYPES,

  catalogs: sites.map(site => ({
    type: site.type,
    id: site.id,
    name: site.name,
    extraSupported: EXTRA
  })),

  behaviorHints: {
    configurable: false
  },

  stremioAddonsConfig: {
    issuer: "https://stremio-addons.net",
    signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..H15_k0Iyb4K2d5Gbz4-rwg.FswET_xxG8N5XtMjR6lpbNburR7DMF2Ie5NjMSlaNGneFEM-28ioA1ofdunoYFheKAmgc1t5cboQSOgTbXpjPflnSAY9DSJURdIZxfrrYg_LoOLpDqyIgOHS42t6xOYS.-gPH7tB42CWK0qMRv2HtFw"
  }
};
