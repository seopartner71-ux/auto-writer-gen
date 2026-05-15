/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  email?: string
  fullName?: string
  niche?: string
  plannedArticles?: string | number
  referralSource?: string
  ip?: string
  registeredAt?: string
}

const AdminNewUserEmail = ({
  email = '-', fullName = '-', niche = '-',
  plannedArticles = '-', referralSource = '-', ip = '-', registeredAt = '',
}: Props) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>Новый пользователь: {email}</Preview>
    <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }}>
      <Container style={{ padding: '20px 25px' }}>
        <Heading style={{ fontSize: '22px', fontWeight: 'bold', color: '#0F1117', margin: '0 0 20px' }}>
          Новый пользователь зарегистрировался
        </Heading>
        <Text style={text}><strong>Email:</strong> {email}</Text>
        <Text style={text}><strong>Имя:</strong> {fullName}</Text>
        <Text style={text}><strong>Тематика:</strong> {niche}</Text>
        <Text style={text}><strong>Планирует статей в месяц:</strong> {String(plannedArticles)}</Text>
        <Text style={text}><strong>Источник:</strong> {referralSource}</Text>
        <Text style={text}><strong>IP:</strong> {ip}</Text>
        {registeredAt ? <Text style={text}><strong>Время:</strong> {registeredAt}</Text> : null}
        <Hr />
        <Text style={{ fontSize: '12px', color: '#999999', margin: '20px 0 0' }}>
          Аккаунт будет активирован автоматически через 2 минуты.
        </Text>
      </Container>
    </Body>
  </Html>
)

const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.5', margin: '0 0 10px' }

export const template: TemplateEntry = {
  component: AdminNewUserEmail,
  subject: (d: Props) => `Новый пользователь: ${d?.email || ''}`,
  displayName: 'Admin: новый пользователь',
  to: 'sinitsin3@yandex.ru',
  previewData: {
    email: 'test@example.com', fullName: 'Иван Иванов', niche: 'SEO',
    plannedArticles: 10, referralSource: 'Google', ip: '127.0.0.1',
  },
}