module.exports = {
  displayName: 'api-e2e',
  rootDir: '..',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.js'],
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  testTimeout: 30000,
  maxWorkers: 1,
};
