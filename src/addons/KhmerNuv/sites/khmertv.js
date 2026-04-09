const { buildStream } = require("../utils/streamResolvers");

const CHANNELS = [
  {
    title: "Apsara",
    link: "https://live.ams.com.kh/app/stream/playlist.m3u8",
    thumbnail: "https://www.phumi7.net/uploads/tv/apsara.jpeg",
    resolve: true
  },
  {
    title: "ETV",
    link: "https://live-evg17.tv360.metfone.com.kh/LiveApp/streams/eacnews.m3u8",
    thumbnail: "https://ia801501.us.archive.org/19/items/dog_gear_live_Logo/etv-channel.jpg",
    resolve: true
  },    
  {
    title: "KhmerTV",
    link: "https://livefta.malimarcdn.com/ftaedge00/khmertv2020.stream/chunklist.m3u8",
    thumbnail: "https://www.phumi7.net/uploads/tv/khmertv.png",
    resolve: true
  },
  {
    title: "Netlink",
    link: "https://netlink.netlinkbroadcaster.com/hls/test.m3u8",
    thumbnail: "https://ia800600.us.archive.org/32/items/dog_gear_live_Logo/dvarietyX250_thumb.jpg",
    resolve: true
  },
  {
    title: "SeaTV HD",
    link: "https://seatv.netlinkbroadcaster.com/hls/test.m3u8",
    thumbnail: "https://ia601501.us.archive.org/19/items/dog_gear_live_Logo/seatv-channel.png",
    resolve: true
  },
  {
    title: "TV9",
    link: "http://43.245.219.190:8183/CTV9HD@1.m3u8",
    thumbnail: "http://1.bp.blogspot.com/-1QUe8XZ2qBE/UXLF8JpSlII/AAAAAAAAP5k/MREE15q7Rb0/s1600/khmer-tv9-online.png",
    resolve: true
  },
  {
    title: "TVK",
    link: "https://live.kh.malimarcdn.com/live/tvk.stream/chunklist.m3u8",
    thumbnail: "https://ia801501.us.archive.org/19/items/dog_gear_live_Logo/tvk-channel.png",
    resolve: true
  },
  {
    title: "TVK2",
    link: "https://live.kh.malimarcdn.com/live/tvk2.stream/playlist.m3u8",
    thumbnail: "https://ia801501.us.archive.org/19/items/dog_gear_live_Logo/tvk-channel.png",
    resolve: true
  }
];

function findChannelByUrl(url) {
  return CHANNELS.find((item) => item.link === url) || null;
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix) {
  return CHANNELS.map((item) => ({
    id: `${prefix}:${encodeURIComponent(item.link)}`,
    name: item.title,
    poster: item.thumbnail
  }));
}

/* =========================
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl) {
  const channel = findChannelByUrl(seriesUrl);
  if (!channel) return [];

  return [
    {
      id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:1`,
      title: channel.title,
      season: 1,
      episode: 1,
      thumbnail: channel.thumbnail,
      released: new Date().toISOString()
    }
  ];
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, seriesUrl) {
  const channel = findChannelByUrl(seriesUrl);
  if (!channel || !channel.link) return null;

  return buildStream(
    channel.link,
    1,
    channel.title,
    "KhmerTV",
    "khmertv",
    null
  );
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream
};