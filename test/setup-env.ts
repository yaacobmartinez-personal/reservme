// Runs in every test worker before any test file. Fills the test env unless the
// caller already set it (CI does). Keeps the DB modules from throwing on import.
import { TEST_ENV } from "./test-env";

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] ??= value;
}
