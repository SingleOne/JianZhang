export interface AiTAdviceStatus {
  enabled: false
  message: string
}

export interface AiTAdviceApi {
  getStatus: () => Promise<AiTAdviceStatus>
}

declare global {
  interface Window {
    aiTAdviceApi?: AiTAdviceApi
  }
}

export {}
