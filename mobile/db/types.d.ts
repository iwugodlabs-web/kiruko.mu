import { userProfiles } from "@/db/schema";
import { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import { SQLiteDatabase } from "expo-sqlite";

export type UserProfile = typeof userProfiles.$inferSelect;

export type TDrizzleDB = ExpoSQLiteDatabase<typeof schema> & {
  $client: SQLiteDatabase;
};
