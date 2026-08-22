// Mock expo-file-system for Jest
export const documentDirectory = "/mocked/path/";
export const deleteAsync = jest.fn().mockResolvedValue(undefined);
export const readAsStringAsync = jest.fn().mockResolvedValue('');
export const writeAsStringAsync = jest.fn().mockResolvedValue('');
