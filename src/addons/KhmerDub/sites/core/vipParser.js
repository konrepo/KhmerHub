const { extractVideoLinks } = require("../../utils/helpers");

/* =========================
   VIP PARSER
========================= */
function parseVipBloggerContent(content = "") {
  const urls = [];
  const okIds = [];

  urls.push(...extractVideoLinks(content));

  let match;

  const dmRegex = /\{dm=(\w+)\}/gi;
  while ((match = dmRegex.exec(content)) !== null) {
    urls.push(`https://www.dailymotion.com/embed/video/${match[1]}`);
  }

  const gdRegex = /\{gd=(\w+)\}/gi;
  while ((match = gdRegex.exec(content)) !== null) {
    urls.push(`https://drive.google.com/file/d/${match[1]}/preview`);
  }

  const okRegex = /\{ok=(\w+)\}/gi;
  while ((match = okRegex.exec(content)) !== null) {
    okIds.push(match[1]);
  }

  if (/\{embed\s*=\s*ok\}/i.test(content)) {
    okIds.forEach((id) => {
      urls.push(`https://ok.ru/videoembed/${id}`);
    });
  }

  const parts = content
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (/^https?:\/\//i.test(part)) {
      urls.push(part);
      continue;
    }

    const dm = part.match(/\{dm=(\w+)\}/i);
    if (dm) {
      urls.push(`https://www.dailymotion.com/embed/video/${dm[1]}`);
      continue;
    }

    const gd = part.match(/\{gd=(\w+)\}/i);
    if (gd) {
      urls.push(`https://drive.google.com/file/d/${gd[1]}/preview`);
      continue;
    }

    const ok = part.match(/\{ok=(\w+)\}/i);
    if (ok) {
      urls.push(`https://ok.ru/videoembed/${ok[1]}`);
    }
  }

  return [...new Set(urls)];
}

module.exports = {
  parseVipBloggerContent,
};