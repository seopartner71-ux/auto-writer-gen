/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props { fullName?: string }

const SITE_NAME = 'СЕО-Модуль'
const SITE_URL = 'https://seo-modul.pro'

const Day3Email = ({ fullName }: Props) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>3 фичи {SITE_NAME}, которые экономят часы работы</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{fullName ? `${fullName}, ` : ''}посмотрите эти 3 фичи</Heading>
        <Text style={text}>
          Уже третий день вы с нами. Делимся инструментами, которые наши пользователи
          называют самыми полезными.
        </Text>
        <Heading as="h2" style={h2}>1. AI Radar (GEO)</Heading>
        <Text style={text}>
          Проверка, как вас видят ChatGPT, Gemini и Perplexity. Понимаете пробелы и
          закрываете их статьями.
        </Text>
        <Heading as="h2" style={h2}>2. Smart Research + Deep Parsing</Heading>
        <Text style={text}>
          Анализ ТОП-10 конкурентов, извлечение сущностей и Content Gap за один клик.
        </Text>
        <Heading as="h2" style={h2}>3. Site Factory</Heading>
        <Text style={text}>
          Массовая генерация PBN-сайтов на Cloudflare с автопостингом. Только для PRO/FACTORY.
        </Text>
        <Section style={{ textAlign: 'center', margin: '28px 0' }}>
          <Button href={`${SITE_URL}/dashboard`} style={btn}>Открыть кабинет</Button>
        </Section>
        <Hr />
        <Text style={footer}>Если что-то не работает - напишите в поддержку прямо из кабинета.</Text>
      </Container>
    </Body>
  </Html>
)

export const template: TemplateEntry = {
  component: Day3Email,
  subject: '3 фичи СЕО-Модуля, которые экономят часы работы',
  displayName: 'Onboarding Day 3',
  previewData: { fullName: 'Иван' },
}

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '600px' }
const h1 = { fontSize: '24px', fontWeight: 700, color: '#0F1117', margin: '0 0 16px' }
const h2 = { fontSize: '17px', fontWeight: 600, color: '#0F1117', margin: '22px 0 8px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.6', margin: '0 0 12px' }
const btn = { background: '#6366f1', color: '#fff', padding: '12px 28px', borderRadius: '8px', textDecoration: 'none', fontWeight: 600, fontSize: '15px' }
const footer = { fontSize: '12px', color: '#999', margin: '20px 0 0' }