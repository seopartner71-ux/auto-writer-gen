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

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>Сброс пароля в {siteName}</Preview>
    <Body style={main}>
      <Container style={outerContainer}>
        <BrandHeader />
        <Container style={card}>
          <Heading style={h1}>Сброс пароля</Heading>
          <Text style={text}>
            Мы получили запрос на сброс пароля для аккаунта в {siteName}.
            Нажмите кнопку ниже, чтобы задать новый пароль.
          </Text>
          <Button style={button} href={confirmationUrl}>
            Задать новый пароль
          </Button>
          <Text style={mutedText}>
            Ссылка действительна 60 минут. Если вы не запрашивали сброс -
            просто игнорируйте это письмо, пароль останется прежним.
          </Text>
        </Container>
      </Container>
      <BrandFooter />
    </Body>
  </Html>
)

export default RecoveryEmail
