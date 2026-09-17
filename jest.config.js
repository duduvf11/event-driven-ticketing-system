/** @type {import('jest').Config} */

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.spec.ts', '**/*.test.ts'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
    maxWorkers: 1,
    testTimeout: 30000,
    verbose: true,
    forceExit: false,
};
