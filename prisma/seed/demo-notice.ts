import type { Promotion } from '@/lib/templates/types';

/**
 * The card a template demo shows above its products (spec 2026-10-18-template-studio-design.md: demonstration content is
 * labelled as such), in the template's promotion slot, so a guest opening a demo menu sees it is not a real business.
 */
export const DEMO_NOTICE: Promotion = {
  title: { en: 'Demonstration menu', ar: 'قائمة تجريبية', ckb: 'مینیوی نموونە' },
  body: {
    en: 'A fictional business, made to preview this template.',
    ar: 'نشاط تجاري وهمي، صُمّم لمعاينة هذا القالب.',
    ckb: 'کارێکی خەیاڵییە، بۆ پێشبینینی ئەم قاڵبە دروست کراوە.',
  },
  terms: {
    en: 'Dishes, prices, address and hours are invented.',
    ar: 'الأطباق والأسعار والعنوان وساعات العمل كلها مختلقة.',
    ckb: 'خواردن و نرخ و ناونیشان و کاتەکان هەموویان دروستکراون.',
  },
};
