import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Względna ścieżka bazowa: zbudowaną aplikację można otworzyć z dowolnego katalogu
// lub hostingu statycznego (np. GitHub Pages) bez dodatkowej konfiguracji.
export default defineConfig({
  base: './',
  plugins: [react()],
});
