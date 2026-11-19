module.exports = {
  displayName: 'api-unit',
  rootDir: '..',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.js'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
};
