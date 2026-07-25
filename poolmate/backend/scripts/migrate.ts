import { loadConfig } from "../src/config.js";
import { PoolMateDatabase } from "../src/infrastructure/db/database.js";

const config = loadConfig();
const database = new PoolMateDatabase(
  config.database.path,
  config.database.migrationsDir
);

database.migrate();
database.close();
console.log("PoolMate migrations applied.");
