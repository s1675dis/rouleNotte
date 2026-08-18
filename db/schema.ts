import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const spins = sqliteTable("spins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: integer("number").notNull(),
  createdAt: text("created_at").notNull(),
});
