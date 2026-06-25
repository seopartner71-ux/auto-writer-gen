/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  fullName?: string
  reason?: string
}

const UserActivationRejectedEmail = ({
  fullName = '',
  reason = '',
}: Props) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>Заявка на доступ к СЕО-Модулю отклонена</Preview>
    <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }}>
      <Container style={{ padding: '24px 28px', maxWidth: 560 }}>
        <Heading style={{ fontSize: '22px', fontWeight: 'bold', color: '#0F1117', margin: '0 0 16px' }}>
          Заявка отклонена{fullName ? `, ${fullName}` : ''}
        </Heading>
        <Text style={text}>
          К сожалению, мы не можем открыть доступ к СЕО-Модулю по вашей заявке.
        </Text>
        {reason ? (
          <Text style={{ ...text, background: '#f6f7fb', borderRadius: 8, padding: '12px 14px' }}>
            <strong>Причина:</strong> {reason}
          </Text>
        ) : null}
        <Text style={text}>
          Если считаете, что это ошибка — напишите нам в Telegram{' '}
          <a href="https://t.me/sin0ptick" style={{ color: '#2563eb' }}>@sin0ptick</a>.
        </Text>
      </Container>
    </Body>
  </Html>
)

const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.6', margin: '0 0 10px' }

export const template: TemplateEntry = {
  component: UserActivationRejectedEmail,
  subject: 'Заявка на доступ к СЕО-Модулю отклонена',
  displayName: 'User: отклонение заявки',
  previewData: { fullName: 'Иван', reason: 'Заявка дублирует уже существующий аккаунт.' },
}