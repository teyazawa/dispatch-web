import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        voicePanel: path.resolve(__dirname, 'voice-panel.html'),
        settings: path.resolve(__dirname, 'settings-window.html'),
      },
    },
  },
})