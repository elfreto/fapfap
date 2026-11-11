import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Bibliothèques dans des fichiers à part : elles restent en cache du navigateur quand seul le jeu change.
        manualChunks: { react: ["react", "react-dom"] },
      },
    },
  },
});
