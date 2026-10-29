let lastImportAt = 0;
export async function paceImports() {
  // Keep the application's real six-per-minute protection enabled during tests.
  const remaining = Math.max(0, lastImportAt + 10_500 - Date.now());
  if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
  lastImportAt = Date.now();
}
