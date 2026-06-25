/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  fullName?: string
  loginUrl?: string
}

const UserActivationApprovedEmail = ({
  fullName = '',
  loginUrl = 'https://app.seo-modul.pro/login',
}: Props) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>Ваш доступ к СЕО-Модулю открыт</Preview>
    <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }}>
      <Container style={{ padding: '24px 28px', maxWidth: 560 }}>
        <Heading style={{ fontSize: '22px', fontWeight: 'bold', color: '#0F1117', margin: '0 0 16px' }}>
          Доступ открыт{fullName ? `, ${fullName}` : ''} 🎉
        </Heading>
        <Text style={text}>
          Ваша заявка одобрена. Аккаунт активирован — можно входить и начинать работу
          в СЕО-Модуле.
        </Text>
        <Button
          href={loginUrl}
          style={{
            background: '#2563eb', color: '#ffffff', padding: '12px 22px',
            borderRadius: 8, fontWeight: 600, textDecoration: 'none', display: 'inline-block',
            margin: '12px 0 18px',
          }}
        >
          Войти в СЕО-Модуль
        </Button>
        <Text style={{ ...text, fontSize: '12px', color: '#666' }}>
          Если кнопка не работает, скопируйте ссылку: {loginUrl}
        </Text>
      </Container>
    </Body>
  </Html>
)

const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.6', margin: '0 0 10px' }

export const template: TemplateEntry = {
  component: UserActivationApprovedEmail,
  subject: 'Ваш доступ к СЕО-Модулю открыт',
  displayName: 'User: активация аккаунта',
  previewData: {
    fullName: 'Иван',
    loginUrl: 'https://app.seo-modul.pro/login',
  },
}