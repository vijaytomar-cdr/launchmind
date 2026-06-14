/**
 * @file lib/types/settings.ts
 * @description Types for the settings page left-nav layout.
 */

export type SettingsTab =
  | 'profile'
  | 'security'
  | 'content'
  | 'voice'
  | 'notifications'
  | 'products'
  | 'account'

export interface SettingsNavItem {
  id: SettingsTab
  label: string
  badge?: string
}

export const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'profile',       label: 'Profile' },
  { id: 'security',      label: 'Security' },
  { id: 'content',       label: 'Content types', badge: 'New' },
  { id: 'voice',         label: 'Voice clone',   badge: 'New' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'products',      label: 'Products' },
  { id: 'account',       label: 'Account management' },
]

export interface ArchivedProduct {
  id: string
  name: string
  category: string | null
  markets: string[]
  platform: string
  archived_at: string
  archive_reason: string | null
}
