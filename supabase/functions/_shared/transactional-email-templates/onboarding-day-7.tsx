/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props { fullName?: string; hasArticles?: boolean }

const SITE_NAME = 'СЕО-Модуль'
const SITE_URL = 'https://seo-modul.pro'

const Day7Email = ({ fullName, hasArticles }: Props) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>{hasArticles ? 'Готовы масштабировать контент?' : 'Помочь со стартом?'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {fullName ? `${fullName}, ` : ''}
          {hasArticles ? 'готовы масштабировать контент?' : 'нужна помощь со стартом?'}
        </Heading>
        {hasArticles ? (
          <>
            <Text style={text}>
              Вы уже попробовали генерацию. На тарифе PRO открываются: Claude Opus,
              Site Factory, GoGetLinks, Miralinks и приоритет в очереди.
            </Text>
            <Text style={text}>
              Практика показывает: пользователи PRO выпускают в 8-12 раз больше статей
              в месяц по сравнению с базовым тарифом.
            </Text>
            <Section style={{ textAlign: 'center', margin: '28px 0' }}>
              <Button href={`${SITE_URL}/pricing`} style={btn}>Посмотреть тарифы</Button>
            </Section>
          </>
        ) : (
          <>
            <Text style={text}>
              Заметили, что вы еще не сгенерировали первую статью. Это занимает 5 минут
              и не требует настройки.
            </Text>
            <Text style={text}>
              Если столкнулись с вопросом - ответьте на это письмо, и мы поможем.
            </Text>
            <Section style={{ textAlign: 'center', margin: '28px 0' }}>
              <Button href={`${SITE_URL}/welcome`} style={btn}>Запустить генерацию</Button>
            </Section>
          </>
        )}
        <Hr />
        <Text style={footer}>{SITE_NAME} - SEO-контент, который ранжируется.</Text>
      </Container>
    </Body>
  </Html>
)

export const template: TemplateEntry = {
  component: Day7Email,
  subject: (d: Props) => d?.hasArticles ? 'Готовы масштабировать контент?' : 'Нужна помощь со стартом в СЕО-Модуле?',
  displayName: 'Onboarding Day 7',
  previewData: { fullName: 'Иван', hasArticles: true },
}

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '600px' }
const h1 = { fontSize: '24px', fontWeight: 700, color: '#0F1117', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#3a3a3a', lineHeight: '1.6', margin: '0 0 12px' }
const btn = { background: '#6366f1', color: '#fff', padding: '12px 28px', borderRadius: '8px', textDecoration: 'none', fontWeight: 600, fontSize: '15px' }
const footer = { fontSize: '12px', color: '#999', margin: '20px 0 0' }