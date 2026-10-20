/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Put <title> and meta tags in <head> for every visitor, not only the bots
  // Next recognizes. Otherwise link previews (Discord, Reddit), Bing and
  // Lighthouse see the page without a description.
  htmlLimitedBots: /.*/,
};

module.exports = nextConfig;
