export async function authorizeAndCreatePickerSession<T>(
  authorize: () => Promise<unknown>,
  createSession: () => Promise<T>,
): Promise<T> {
  await authorize()
  return createSession()
}
