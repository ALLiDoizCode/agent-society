// ESM wrapper for napi-rs native binding (CJS)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const native = require('./index.cjs');

export const { PetBrain } = native;
