export async function authorizeAndCreatePickerSession<TAuthorization, TSession>(
  authorize: () => Promise<TAuthorization>,
  createSession: (authorization: TAuthorization) => Promise<TSession>,
): Promise<TSession> {
  const authorization = await authorize()
  return createSession(authorization)
}
