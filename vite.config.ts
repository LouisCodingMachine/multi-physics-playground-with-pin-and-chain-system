import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/logger/log': {
        target: 'http://ec2-13-239-234-81.ap-southeast-2.compute.amazonaws.com:3000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/logger\/log/, '/logger/log'),
      },
    },
  },
});