import express, { type Express } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static serving of the built CRA client. The server's ONLY HTTP job — assets
 * (models, textures, audio) come from the public R2 bucket, fetched by the
 * browser directly, never through here.
 *
 * Resolved relative to this file so it works from `server/dist` (prod) and
 * from `server/src` under tsx (dev) alike: both are one level below `server/`,
 * and the client build is at `<repo>/build`.
 */
const CLIENT_BUILD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../build");

const ONE_YEAR_S = 60 * 60 * 24 * 365;

export const createApp = (): Express => {
  const app = express();
  app.disable("x-powered-by");

  if (!existsSync(path.join(CLIENT_BUILD_DIR, "index.html"))) {
    console.warn(`[http] no client build at ${CLIENT_BUILD_DIR} — run \`npm run build\` at the repo root`);
  }

  // CRA content-hashes everything under build/static, so it is safe to cache
  // forever. index.html is NOT hashed and must never be cached, or a deploy
  // would keep serving an index that points at chunks that no longer exist.
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

  // Catch-all: the client's domain paths (/, /glitch-city) are client-side
  // pushState routes, so every unknown GET gets index.html and the client
  // boots whichever domain the path names.
  app.get("*", (req, res, next) => {
    if (req.method !== "GET" || req.path.includes(".")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(CLIENT_BUILD_DIR, "index.html"));
  });

  return app;
};
