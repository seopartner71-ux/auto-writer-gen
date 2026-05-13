/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>Ваша ссылка для входа в {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Ссылка для входа</Heading>
        <Text style={text}>
          Нажмите кнопку ниже, чтобы войти в {siteName}. Ссылка скоро
          станет недействительной.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Войти
        </Button>
        <Text style={footer}>
          Если вы не запрашивали ссылку, проигнорируйте это письмо.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#0F1117',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#7A8699',
  lineHeight: '1.5',
  margin: '0 0 25px',
}
const button = {
  backgroundColor: '#A855F7',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
