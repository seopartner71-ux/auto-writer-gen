/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { template as adminNewUser } from './admin-new-user.tsx'
import { template as onboardingDay1 } from './onboarding-day-1.tsx'
import { template as onboardingDay3 } from './onboarding-day-3.tsx'
import { template as onboardingDay7 } from './onboarding-day-7.tsx'
import { template as userActivationApproved } from './user-activation-approved.tsx'
import { template as userActivationRejected } from './user-activation-rejected.tsx'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: any) => string)
  displayName?: string
  previewData?: Record<string, any>
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'admin-new-user': adminNewUser,
  'onboarding-day-1': onboardingDay1,
  'onboarding-day-3': onboardingDay3,
  'onboarding-day-7': onboardingDay7,
  'user-activation-approved': userActivationApproved,
  'user-activation-rejected': userActivationRejected,
}