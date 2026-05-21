#!/usr/bin/env bun
// Fixture: hangs forever without producing any stdout output.
await new Promise<never>(() => {})
