import { common } from './common';
import { nav } from './nav';
import { article } from './article';
import { quality } from './quality';
import { factory } from './factory';
import { tools } from './tools';
import { billing } from './billing';
import { onboarding } from './onboarding';
import { legal } from './legal';
import { funnel } from './funnel';
import type { Dict } from './types';

export type { Lang, Dict } from './types';

export const translations: Dict = { ...common, ...nav, ...article, ...quality, ...factory, ...tools, ...billing, ...onboarding, ...legal, ...funnel };
