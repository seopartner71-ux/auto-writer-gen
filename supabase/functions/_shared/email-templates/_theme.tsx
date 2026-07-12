/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Container,
  Hr,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

// Brand palette — Premium Minimalism v3
export const brand = {
  bg: '#ffffff',
  card: '#0A0A0A',
  cardBorder: '#1F1F23',
  ink: '#F5F5F7',
  inkMuted: '#9CA0A8',
  accent: '#6E56CF',
  accentInk: '#FFFFFF',
  divider: '#E5E7EB',
  footerInk: '#6B7280',
  name: 'СЕО-Модуль',
  domain: 'seo-modul.pro',
}

export const main = {
  backgroundColor: brand.bg,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Arial, sans-serif",
  margin: 0,
  padding: '32px 12px',
}

export const outerContainer = {
  maxWidth: '520px',
  margin: '0 auto',
}

export const brandHeader = {
  padding: '0 4px 20px',
}

export const brandName = {
  fontSize: '15px',
  fontWeight: 600 as const,
  color: '#0A0A0A',
  letterSpacing: '-0.01em',
  margin: 0,
}

export const card = {
  backgroundColor: brand.card,
  border: `1px solid ${brand.cardBorder}`,
  borderRadius: '14px',
  padding: '32px 28px',
  color: brand.ink,
}

export const h1 = {
  fontSize: '22px',
  fontWeight: 600 as const,
  color: brand.ink,
  letterSpacing: '-0.01em',
  lineHeight: '1.3',
  margin: '0 0 16px',
}

export const text = {
  fontSize: '15px',
  color: brand.ink,
  lineHeight: '1.6',
  margin: '0 0 20px',
}

export const mutedText = {
  fontSize: '13px',
  color: brand.inkMuted,
  lineHeight: '1.55',
  margin: '24px 0 0',
}

export const link = {
  color: '#B6A6F0',
  textDecoration: 'underline',
}

export const button = {
  backgroundColor: brand.accent,
  color: brand.accentInk,
  fontSize: '14px',
  fontWeight: 600 as const,
  borderRadius: '10px',
  padding: '13px 22px',
  textDecoration: 'none',
  display: 'inline-block',
}

export const codeBox = {
  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: '26px',
  fontWeight: 700 as const,
  letterSpacing: '0.28em',
  color: brand.ink,
  backgroundColor: '#141418',
  border: `1px solid ${brand.cardBorder}`,
  borderRadius: '10px',
  padding: '18px 20px',
  textAlign: 'center' as const,
  margin: '0 0 8px',
}

export const divider = {
  borderColor: brand.divider,
  borderStyle: 'solid',
  borderWidth: '0 0 1px',
  margin: '24px 0 12px',
}

export const footerText = {
  fontSize: '12px',
  color: brand.footerInk,
  lineHeight: '1.55',
  textAlign: 'center' as const,
  margin: '4px 0',
}

export const BrandHeader = () => (
  <Section style={brandHeader}>
    <Text style={brandName}>{brand.name}</Text>
  </Section>
)

export const BrandFooter = () => (
  <Container style={outerContainer}>
    <Hr style={divider} />
    <Text style={footerText}>
      {brand.name} · <span style={{ color: '#9CA3AF' }}>{brand.domain}</span>
    </Text>
    <Text style={footerText}>
      Это служебное письмо. Отвечать на него не нужно.
    </Text>
  </Container>
)