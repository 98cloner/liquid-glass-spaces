import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

const external = ["react","react-dom","react/jsx-runtime","@base-ui/react","@floating-ui/react"];
export default defineConfig(({mode}) => mode === 'site'
  ? {plugins: [react()], build: {target: 'esnext', outDir: 'dist-site', rollupOptions: {input: 'site.html'}}}
  : {plugins: [react()], build: {target: 'esnext', copyPublicDir: false, cssCodeSplit: false,
      lib: {entry: 'src/glass/index.ts', formats: ['es'], fileName: () => 'index.js', cssFileName: 'style'},
      rollupOptions: {external: (id) => external.some((e) => id === e || id.startsWith(e + '/'))}}});
