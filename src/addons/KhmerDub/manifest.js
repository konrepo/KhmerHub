const TYPES = ["series", "movie"];
const EXTRA = ["search", "skip"];

const sites = [
  { id: "vip", name: "PhumiVip", type: "series" },
  { id: "sunday", name: "SundayDrama", type: "series" },
  { id: "phumi2", name: "PhumiClub", type: "series" },
  { id: "khmerave", name: "KhmerAve", type: "series" },
  { id: "merlkon", name: "Merlkon", type: "series" },
  { id: "idrama", name: "iDramaHD", type: "series" },
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