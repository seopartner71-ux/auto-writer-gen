/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props { fullName?: string }

const SITE_NAME = 'СЕО-Модуль'
const SITE_URL = 'https://seo-modul.pro'

const Day1Email = ({ fullName }: Props) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>С чего начать в {SITE_NAME}: первая статья за 5 минут</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{fullName ? `Привет, ${fullName}!` : 'Привет!'}</Heading>
        <Text style={text}>
          Спасибо за регистрацию в {SITE_NAME}. На балансе уже есть 2 бесплатных кредита,
          чтобы вы могли протестировать генерацию без вложений.
        </Text>
        <Heading as="h2" style={h2}>Быстрый старт за 3 шага</Heading>
        <Text style={text}>1. Создайте проект и укажите тематику сайта.</Text>
        <Text style={text}>2. Запустите Smart Research по любому ключу.</Text>
        <Text style={text}>3. Сгенерируйте первую SEO-статью с Humanize.</Text>
        <Section style={{ textAlign: 'center', margin: '32px 0' }}>
          <Button href={`${SITE_URL}/welcome`} style={btn}>Создать первую статью</Button>
        </Section>
        <Hr />
        <Text style={footer}>{SITE_NAME} - SEO-контент, который ранжируется.</Text>
      </Container>
    </Body>
  </Html>
)

export const template: TemplateEntry = {
  component: Day1Email,
  subject: 'Добро пожаловать в СЕО-Модуль: первая статья за 5 минут',
  displayName: 'Onboarding Day 1',
  previewData: { fullName: 'Иван' },
}

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '600px' }
const h1 = { fontSize: '24px', fontWeight: 700, color: '#0F1117', margin: '0 0 16px' }
const h2 = { fontSize: '18px', fontWeight: 600, color: '#0F1117', margin: '24px 0 12px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.6', margin: '0 0 12px' }
const btn = { background: '#6366f1', color: '#fff', padding: '12px 28px', borderRadius: '8px', textDecoration: 'none', fontWeight: 600, fontSize: '15px' }
const footer = { fontSize: '12px', color: '#999', margin: '20px 0 0' }