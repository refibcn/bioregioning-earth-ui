import { defineConfig } from 'astro/config';

const SITE_URL = 'https://bioregioning.earth';

export default defineConfig({
  site: SITE_URL,
  base: '/', // custom domain serves from the root — was '/bioregioning-earth-ui' for the
             // default giulioquarta.github.io/bioregioning-earth-ui/ Pages URL
  outDir: './dist',
  srcDir: './src',
});
