import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  devToolbar: { enabled: false },
  integrations: [react()],
  vite: { plugins: [tailwind()] },
});
