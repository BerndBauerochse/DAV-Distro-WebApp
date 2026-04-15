import { useEffect, useRef, useCallback } from 'react'
import type { WsEvent } from '../types'
import { getStoredAuth } from './useAuth'

type Handler = (event: WsEvent) => void

export function useWebSocket(onMessage: Handler) {
  const wsRef = useRef<WebSocket | null>(null)
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  const connect = useCallback(() => {
    const { token } = getStoredAuth()
    if (!token) return

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as WsEvent
        handlerRef.current(data)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      // Reconnect after 2 seconds
      setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws.close()
    }

    wsRef.current = ws
  }, [])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { send }
}
