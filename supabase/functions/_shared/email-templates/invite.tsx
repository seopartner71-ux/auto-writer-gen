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

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>Приглашение в {siteName}</Preview>
    <Body style={main}>
      <Container style={outerContainer}>
        <BrandHeader />
        <Container style={card}>
          <Heading style={h1}>Вас пригласили</Heading>
          <Text style={text}>
            Вас пригласили присоединиться к{' '}
            <Link href={siteUrl} style={link}>
              {siteName}
            </Link>
            . Нажмите кнопку ниже, чтобы принять приглашение и создать аккаунт.
          </Text>
          <Button style={button} href={confirmationUrl}>
            Принять приглашение
          </Button>
          <Text style={mutedText}>
            Если вы не ждали приглашение - просто игнорируйте это письмо.
          </Text>
        </Container>
      </Container>
      <BrandFooter />
    </Body>
  </Html>
)

export default InviteEmail
