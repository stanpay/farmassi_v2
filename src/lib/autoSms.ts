import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  defaultAutoSmsConfig,
  type AutoSmsConfig,
  type AutoSmsExclusion,
  type CallEvent,
} from './callbackRules'

/** android/.../autosms/AutoSmsPlugin.java */
interface AutoSmsPlugin {
  getConfig(): Promise<{ config: AutoSmsConfig }>
  setConfig(options: { config: AutoSmsConfig }): Promise<void>
  getStatus(): Promise<AutoSmsStatus>
  requestPermissions(): Promise<{ phone: string; sms: string }>
  openOverlaySettings(): Promise<void>
  openBatteryOptimizationSettings(): Promise<void>
  getHistory(options?: { limit?: number }): Promise<{ items: AutoSmsHistoryItem[] }>
  clearHistory(): Promise<void>
  sendTest(options: { phone: string }): Promise<void>
  pickContact(): Promise<{ name?: string; phone?: string }>
}

export interface AutoSmsStatus {
  phone: boolean
  sms: boolean
  overlay: boolean
  batteryUnrestricted: boolean
}

export interface AutoSmsHistoryItem {
  id: number
  createdAt: number
  number: string
  event: CallEvent | 'test'
  ruleName: string | null
  status: 'sending' | 'sent' | 'failed' | 'skipped'
  reason: string | null
  message: string | null
}

const AutoSms = registerPlugin<AutoSmsPlugin>('AutoSms')

export function isAutoSmsNative() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

function normalizeConfig(raw: AutoSmsConfig | null | undefined, message: string): AutoSmsConfig {
  const fallback = defaultAutoSmsConfig(message)
  if (!raw || typeof raw !== 'object') return fallback
  return {
    master: Boolean(raw.master),
    popupWhenOff: raw.popupWhenOff !== false,
    message,
    rules: Array.isArray(raw.rules) && raw.rules.length > 0 ? raw.rules : fallback.rules,
    exclusions: Array.isArray(raw.exclusions) ? raw.exclusions : [],
  }
}

export async function loadAutoSmsConfig(message: string): Promise<AutoSmsConfig> {
  if (!isAutoSmsNative()) return defaultAutoSmsConfig(message)
  const { config } = await AutoSms.getConfig()
  return normalizeConfig(config, message)
}

export async function saveAutoSmsConfig(config: AutoSmsConfig) {
  if (!isAutoSmsNative()) return
  await AutoSms.setConfig({ config })
}

export async function loadAutoSmsStatus(): Promise<AutoSmsStatus | null> {
  if (!isAutoSmsNative()) return null
  return AutoSms.getStatus()
}

export async function requestAutoSmsPermissions() {
  if (!isAutoSmsNative()) return
  await AutoSms.requestPermissions()
}

export async function openOverlaySettings() {
  if (!isAutoSmsNative()) return
  await AutoSms.openOverlaySettings()
}

export async function openBatteryOptimizationSettings() {
  if (!isAutoSmsNative()) return
  await AutoSms.openBatteryOptimizationSettings()
}

export async function loadAutoSmsHistory(limit = 100): Promise<AutoSmsHistoryItem[]> {
  if (!isAutoSmsNative()) return []
  const { items } = await AutoSms.getHistory({ limit })
  return items ?? []
}

export async function clearAutoSmsHistory() {
  if (!isAutoSmsNative()) return
  await AutoSms.clearHistory()
}

export async function sendAutoSmsTest(phone: string) {
  await AutoSms.sendTest({ phone })
}

export async function pickExclusionContact(): Promise<AutoSmsExclusion | null> {
  if (!isAutoSmsNative()) return null
  const contact = await AutoSms.pickContact()
  if (!contact.phone) return null
  return { name: contact.name?.trim() || contact.phone, phone: contact.phone }
}
