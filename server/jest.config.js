/** @type {import('jest').Config} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/tests'],
	modulePathIgnorePatterns: ['<rootDir>/dist/'],
	setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
	transform: {
		'^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
	},
};
