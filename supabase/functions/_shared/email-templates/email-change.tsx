/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import {
  BrandFooter,
  BrandHeader,
  button,
  card,
  h1,
  link,
  main,
  mutedText,
  outerContainer,
  text,
} from './_theme.tsx'

interface EmailChangeEmailProps {
  siteName: string
  // oldEmail is the user's current address (HookData.OldEmail). For the
  // NEW-recipient half of a secure email_change fanout, `email` equals the
  // recipient (NEW), so the "from" line must render oldEmail to read
  // "from OLD to NEW" instead of "from NEW to NEW".
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>Подтверждение смены email в {siteName}</Preview>
    <Body style={main}>
      <Container style={outerContainer}>
        <BrandHeader />
        <Container style={card}>
          <Heading style={h1}>Смена адреса email</Heading>
          <Text style={text}>
            Вы запросили смену email в {siteName} с{' '}
            <Link href={`mailto:${oldEmail}`} style={link}>
              {oldEmail}
            </Link>{' '}
            на{' '}
            <Link href={`mailto:${newEmail}`} style={link}>
              {newEmail}
            </Link>
            . Нажмите кнопку ниже, чтобы подтвердить изменение.
          </Text>
          <Button style={button} href={confirmationUrl}>
            Подтвердить смену
          </Button>
          <Text style={mutedText}>
            Если вы не запрашивали смену адреса - срочно смените пароль,
            возможно, доступ к аккаунту скомпрометирован.
          </Text>
        </Container>
      </Container>
      <BrandFooter />
    </Body>
  </Html>
)

export default EmailChangeEmail
