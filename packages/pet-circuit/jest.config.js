/** @type {import('jest').Config} */
module.exports = {
  displayName: 'pet-circuit',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  testTimeout: 180000, // o1js operations can be slow even with proofsEnabled: false
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  // o1js is ESM-native; allow transformation
  transformIgnorePatterns: ['node_modules/(?!o1js/)'],
};
