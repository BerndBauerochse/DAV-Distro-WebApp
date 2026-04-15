import { useState, useCallback } from 'react'

const STORAGE_KEY = 'dav_token'
const USERNAME_KEY = 'dav_username'

export interface AuthState {
  token: string | null
  username: string | null
}

export function getStoredAuth(): AuthState {
  return {
    token: localStorage.getItem(STORAGE_KEY),
    username: localStorage.getItem(USERNAME_KEY),
  }
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(getStoredAuth)

  const login = useCallback((token: string, username: string) => {
    localStorage.setItem(STORAGE_KEY, token)
    localStorage.setItem(USERNAME_KEY, username)
    setAuth({ token, username })
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(USERNAME_KEY)
    setAuth({ token: null, username: null })
  }, [])

  return { auth, login, logout }
}
