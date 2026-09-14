/**
 * Runs before any test module is imported, so configuration is present before
 * src/env.ts is evaluated by anything that imports it.
 */
process.env.AUTH_SECRET ??= "test-secret-value";
process.env.APP_URL ??= "http://localhost:3000";
process.env.SHARE_DOMAIN ??= "localhost:3000";
process.env.AUTH_GOOGLE_ID ??= "test-google-id";
process.env.AUTH_GOOGLE_SECRET ??= "test-google-secret";
process.env.AUTH_GITHUB_ID ??= "test-github-id";
process.env.AUTH_GITHUB_SECRET ??= "test-github-secret";
