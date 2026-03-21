#!/usr/bin/env node
// Shim: forwards to compiled dist/index.js
// This file is used by the `bin.dev` entry in package.json.
// After `npm run build`, dist/index.js is the real entry.
import '../dist/index.js';
