import { drizzle, ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import * as schema from "@/db/schema";
import { TDrizzleDB, UserProfile } from "@/db/types";
import { createId } from "@paralleldrive/cuid2";
import { userProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";

class UserNotFoundErr extends Error {}

export const createUserProfile = async (
  db: ExpoSQLiteDatabase,
  userProfile: UserProfile,
): Promise<UserProfile | undefined> => {
  const userAccountID = createId();

  /* Note we can use returning() to get the data but this returns an array */
  await db.insert(userProfiles).values({
    userAccountID,
    authorUserAccountID: userAccountID,
    firstName: userProfile.firstName,
    lastName: userProfile.lastName,
    //   TODO: Add support for S3 image
  });

  const drizzleDb = drizzle(db as any, { schema });

  return await getUserProfile(drizzleDb, userAccountID);
};

export const getUserProfiles = async (db: any): Promise<UserProfile[]> => {
  const user = {}; // const user =  await currentUser(); TODO IMPLEMENT GET currentUser

  if (!user) throw new UserNotFoundErr();

  const drizzleDb = drizzle(db, { schema });

  return await drizzleDb.query.userProfiles.findMany();
};

export const getUserProfile = async (
  drizzleDb: TDrizzleDB,
  userAccountID: string,
): Promise<UserProfile | undefined> => {
  return await drizzleDb.query.userProfiles.findFirst({
    where: eq(userProfiles.userAccountID, userAccountID),
  });
};
