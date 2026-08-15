export class UserFacingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'UserFacingError'
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly apiStatus?: string

  constructor(status: number, message: string, apiStatus?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.apiStatus = apiStatus
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
