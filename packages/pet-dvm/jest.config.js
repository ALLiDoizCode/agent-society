/** @type {import('jest').Config} */
module.exports = {
  displayName: 'pet-dvm',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  testTimeout: 30000,
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  // o1js is ESM-native; allow transformation (needed because pet-circuit re-exports from o1js)
  transformIgnorePatterns: ['node_modules/(?!o1js/)'],
};
