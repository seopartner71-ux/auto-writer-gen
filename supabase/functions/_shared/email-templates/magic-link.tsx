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
import {
  BrandFooter,
  BrandHeader,
  button,
  card,
  h1,
  main,
  mutedText,
  outerContainer,
  text,
} from './_theme.tsx'

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
    <Preview>Ссылка для входа в {siteName}</Preview>
    <Body style={main}>
      <Container style={outerContainer}>
        <BrandHeader />
        <Container style={card}>
          <Heading style={h1}>Ссылка для входа</Heading>
          <Text style={text}>
            Нажмите кнопку ниже, чтобы войти в {siteName}. Ссылка действительна
            ограниченное время.
          </Text>
          <Button style={button} href={confirmationUrl}>
            Войти в аккаунт
          </Button>
          <Text style={mutedText}>
            Если вы не запрашивали ссылку - просто игнорируйте это письмо.
          </Text>
        </Container>
      </Container>
      <BrandFooter />
    </Body>
  </Html>
)

export default MagicLinkEmail
