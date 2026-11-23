/** Any non-production build: `npm start` / `npm run dev` and jest. Three-free (the server reads it too). */
export const IS_DEV = process.env.NODE_ENV !== "production";
