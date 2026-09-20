import express, { type Express } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Relative to this file: server/dist (prod) and server/src (tsx dev) are both one
// level below server/, and the client build is at <repo>/build.
const CLIENT_BUILD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../build");

const ONE_YEAR_S = 60 * 60 * 24 * 365;

export const createApp = (): Express => {
  const app = express();
  app.disable("x-powered-by");

  if (!existsSync(path.join(CLIENT_BUILD_DIR, "index.html"))) {
    console.warn(`[http] no client build at ${CLIENT_BUILD_DIR} — run \`npm run build\` at the repo root`);
  }

  // build/static is content-hashed → immutable. index.html is NOT, and a cached
  // index would point at chunks a deploy removed.
  app.use(
    "/static",
    express.static(path.join(CLIENT_BUILD_DIR, "static"), {
      immutable: true,
      maxAge: ONE_YEAR_S * 1000,
      fallthrough: false,
    }),
  );
  app.use(
    express.static(CLIENT_BUILD_DIR, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );

  // Domain paths (/, /glitch-city) are client-side pushState routes.
  app.get("*", (req, res, next) => {
    if (req.method !== "GET" || req.path.includes(".")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(CLIENT_BUILD_DIR, "index.html"));
  });

  return app;
};
