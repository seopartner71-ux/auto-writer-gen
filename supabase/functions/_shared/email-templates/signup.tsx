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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>Подтверждение email в {siteName}</Preview>
    <Body style={main}>
      <Container style={outerContainer}>
        <BrandHeader />
        <Container style={card}>
          <Heading style={h1}>Подтвердите email</Heading>
          <Text style={text}>
            Спасибо за регистрацию в{' '}
            <Link href={siteUrl} style={link}>
              {siteName}
            </Link>
            . Осталось подтвердить адрес{' '}
            <Link href={`mailto:${recipient}`} style={link}>
              {recipient}
            </Link>
            .
          </Text>
          <Button style={button} href={confirmationUrl}>
            Подтвердить email
          </Button>
          <Text style={mutedText}>
            Если вы не регистрировались - просто игнорируйте это письмо.
          </Text>
        </Container>
      </Container>
      <BrandFooter />
    </Body>
  </Html>
)

export default SignupEmail
