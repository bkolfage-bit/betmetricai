
import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = import.meta.dirname;

// https://vite.dev/config/
export default defineConfig(async ({ command }) => {
  const plugins = [react()];

  if (command === "serve") {
    const [{ default: devServer }, { inspectAttr }] = await Promise.all([
      import("@hono/vite-dev-server"),
      import("kimi-plugin-inspect-react"),
    ]);

    plugins.unshift(
      devServer({
        entry: "api/boot.ts",
        exclude: [/^\/(?!api\/).*$/],
      })
    );

    plugins.push(inspectAttr());
  }

  return {
    plugins,
    server: {
      port: 3000,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@contracts": path.resolve(__dirname, "./contracts"),
        "@db": path.resolve(__dirname, "./db"),
        db: path.resolve(__dirname, "./db"),
      },
    },
    envDir: path.resolve(__dirname),
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
    },
  };
});
