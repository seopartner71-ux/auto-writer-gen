/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
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
  card,
  codeBox,
  h1,
  main,
  mutedText,
  outerContainer,
  text,
} from './_theme.tsx'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>Код подтверждения</Preview>
    <Body style={main}>
      <Container style={outerContainer}>
        <BrandHeader />
        <Container style={card}>
          <Heading style={h1}>Подтверждение действия</Heading>
          <Text style={text}>
            Введите код ниже, чтобы подтвердить вашу личность:
          </Text>
          <Text style={codeBox}>{token}</Text>
          <Text style={mutedText}>
            Код действителен ограниченное время. Если вы не запрашивали
            подтверждение - просто игнорируйте это письмо.
          </Text>
        </Container>
      </Container>
      <BrandFooter />
    </Body>
  </Html>
)

export default ReauthenticationEmail
