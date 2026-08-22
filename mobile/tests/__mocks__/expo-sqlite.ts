// Mock expo-sqlite for Jest
export const openDatabaseSync = jest.fn(() => ({
    insert: jest.fn(),
    query: {
      userProfiles: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    },
    closeSync: jest.fn(),
  }));
  