import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/infrastructure/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.POOLMATE_DATABASE_PATH ?? "./data/poolmate.sqlite"
  },
  strict: true,
  verbose: true
});
