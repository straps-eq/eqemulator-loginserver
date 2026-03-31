import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "@/db/schema";

const globalForDb = globalThis as unknown as {
  mysqlPool: ReturnType<typeof mysql.createPool> | undefined;
};

const pool =
  globalForDb.mysqlPool ??
  mysql.createPool({
    uri: process.env.DATABASE_URL!,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.mysqlPool = pool;
}

export const db = drizzle(pool, { schema, mode: "default" });
export { pool };
