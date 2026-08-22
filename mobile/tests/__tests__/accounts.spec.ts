// TODO: We need to fix the integtated test for db. Error - this.client.prepareSync is not a function

import { drizzle } from "drizzle-orm/expo-sqlite";
import * as schema from "@/db/schema";
import { TDrizzleDB, UserProfile } from "@/db/types";
import migrations from "@/drizzle/migrations"; // Import your migrations file
import { openDatabaseSync, SQLiteDatabase } from "expo-sqlite";
import * as FileSystem from "expo-file-system"; // For creating a file-based database
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { createUserProfile, getUserProfile } from "@/actions/accounts";

class UserNotFoundErr extends Error {}

const DATABASE_NAME = ":memory:";

let SQLite: SQLiteDatabase;
let db: TDrizzleDB;

describe("User Profile Actions", () => {
  // This will run before each test
  beforeAll(async () => {
    SQLite = openDatabaseSync(DATABASE_NAME); // In-memory database
    db = drizzle(SQLite); // Initialize Drizzle ORM with the file-based DB
    // await migrate(db, migrations); // Apply migrations 
  });

  // Clean up after each test
  afterAll(async () => {
    SQLite.closeSync(); // Close the SQLite database
  });

  // Test for createUserProfile
  xit("should create a new user profile", async () => {
    const mockProfile = { firstName: "John", lastName: "Doe" };
    const createdUser = await createUserProfile(
      db,
      mockProfile as UserProfile,
    );
    // Assertions to ensure that the user is created
    expect(createdUser).toBeDefined();
    expect(createdUser?.firstName).toBe("John");
    expect(createdUser?.lastName).toBe("Doe");
    // Verify that the data is in the database
    const retrievedUser = await getUserProfile(
      db,
      createdUser!.userAccountID,
    );
    expect(retrievedUser).toEqual(createdUser);
  });

  // Test for retrieving all user profiles
  //   it("should retrieve all user profiles", async () => {
  //     const mockProfile1 = { firstName: "John", lastName: "Doe" };
  //     const mockProfile2 = { firstName: "Jane", lastName: "Smith" };

  //     await createUserProfile(drizzleDb, mockProfile1 as UserProfile);
  //     await createUserProfile(drizzleDb, mockProfile2 as UserProfile);

  //     const allUsers = await getUserProfiles(drizzleDb);
  //     expect(allUsers.length).toBe(2);
  //     expect(allUsers[0].firstName).toBe("John");
  //     expect(allUsers[1].firstName).toBe("Jane");
  //   });
});
