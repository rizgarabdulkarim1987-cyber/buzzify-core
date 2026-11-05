/**
 * The pure rules of the AI Doctor (spec "AI Doctor behaviour", "Safety framing"). No Prisma, no clock, no model, no I/O:
 *  - the answer shapes the model must fill (strict Zod, plus the JSON-schema form sent as `AiRequest.jsonSchema`);
 *  - `screenComplaint`, the deterministic red-flag screen that runs BEFORE any model call: when it says `mustRefer`, the
 *    service answers "refer to a doctor" and never asks the model for options;
 *  - `finalizeAnswer`, which re-validates what the model returned, rejects an empty answer, puts red flags first and lets a
 *    red flag (or "I am not sure") remove every product suggestion.
 *
 * SAFETY: the screen errs toward referring. A false referral costs a customer a trip to a doctor; a missed one can cost more.
 * Every keyword lives in `RED_FLAG_TERMS` below so a pharmacist can review the whole list in one place.
 */
import { z } from 'zod';
import { toLatinDigits } from '@/server/ai/grounding';

// Modes -----------------------------------------------------------------------------------------------------------------

/** The three ways to ask, as stored in `PhDoctorLog.mode`. Both medicine modes share the medicine answer. */
export const DOCTOR_MODES = ['COMPLAINT', 'MEDICINE_NAME', 'MEDICINE_PHOTO'] as const;
export type DoctorMode = (typeof DOCTOR_MODES)[number];

/** The message key of the fixed line the app renders under EVERY answer (Task 8). The model never writes it. */
export const DOCTOR_DISCLAIMER_KEY = 'pharmacy.doctor.disclaimer';

// Normalising ----------------------------------------------------------------------------------------------------------

/** C0/C1 controls and line/paragraph separators become spaces; bidi controls too. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
/** Invisible joiners are removed so they cannot split a word ("che\u200bst"). ZWNJ is handled apart: Kurdish uses it between words. */
const INVISIBLE = /[\u200b\u200d\u200e\u200f\u2060\ufeff\u00ad]/g;
const ZWNJ = /\u200c/g;
/** Arabic diacritics (harakat, shadda, sukun, superscript alef, Quranic marks) and the tatweel. */
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
/**
 * Letter variants folded to one form, in the text AND in the table, so the way a word is typed does not matter: hamza forms of
 * alef, alef maqsura and the Kurdish/Persian yeh, teh marbuta and the Kurdish ae (both written as heh), Arabic and Kurdish kaf,
 * the Kurdish letters with marks (ڕ ڵ ێ ۆ) typed without them on an Arabic keyboard. Folding makes a few unrelated words look
 * alike; that only ever adds referrals.
 */
const FOLD: ReadonlyArray<readonly [RegExp, string]> = [
  [/[أإآٱ]/g, 'ا'],
  [/[ىیئ]/g, 'ي'],
  [/ؤ/g, 'و'],
  [/[ةەھ]/g, 'ه'],
  [/ك/g, 'ک'],
  [/ڕ/g, 'ر'],
  [/ڵ/g, 'ل'],
  [/ێ/g, 'ي'],
  [/ۆ/g, 'و'],
  [/[’‘`´]/g, "'"],
];

/**
 * The one normal form the screen reads: compatibility forms unfolded (Arabic presentation forms, full-width letters), lower case,
 * Arabic-Indic and Extended Arabic-Indic digits as Latin digits, an Arabic decimal or comma between digits as a point, controls
 * as spaces, invisible characters removed, Arabic marks removed, letter variants folded, runs of spaces collapsed.
 */
export function normalizeForScreening(text: string): string {
  let t = toLatinDigits(text.normalize('NFKC')).toLowerCase();
  t = t.replace(CONTROL, ' ').replace(INVISIBLE, '').replace(ZWNJ, ' ').replace(MARKS, '');
  for (const [re, to] of FOLD) t = t.replace(re, to);
  return t
    .replace(/(\d)[٫,](\d)/g, '$1.$2')
    .replace(/[ \t\f\v\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/g, ' ')
    .trim();
}

// The table ------------------------------------------------------------------------------------------------------------

/** The codes that come from the keyword table, in reporting order (the most urgent first). */
export const TERM_CODES = ['EMERGENCY', 'CHEST_PAIN', 'BREATHING', 'HIGH_FEVER_LONG', 'BLOOD_IN_STOOL', 'STROKE', 'INFANT_FEVER', 'PREGNANCY', 'NEEDS_PRESCRIPTION'] as const;
export type TermCode = (typeof TERM_CODES)[number];
/** Every reason the screen can give: the table's codes, then TOO_LONG (a text too long to screen in full). */
export const RED_FLAG_CODES = [...TERM_CODES, 'TOO_LONG'] as const;
export type RedFlagCode = (typeof RED_FLAG_CODES)[number];

/**
 * What kind of referral a code is, so the app can label it apart (Task 8 maps codes to messages): a clinical RED_FLAG, a
 * NEEDS_PRESCRIPTION referral (not an emergency: the complaint needs something only a doctor can prescribe, so nothing is
 * named), or UNSCREENED (the text was too long to screen in full, so the app refers rather than trust a partial screen).
 */
export const RED_FLAG_KIND: Readonly<Record<RedFlagCode, 'RED_FLAG' | 'NEEDS_PRESCRIPTION' | 'UNSCREENED'>> = {
  EMERGENCY: 'RED_FLAG',
  CHEST_PAIN: 'RED_FLAG',
  BREATHING: 'RED_FLAG',
  HIGH_FEVER_LONG: 'RED_FLAG',
  BLOOD_IN_STOOL: 'RED_FLAG',
  STROKE: 'RED_FLAG',
  INFANT_FEVER: 'RED_FLAG',
  PREGNANCY: 'RED_FLAG',
  NEEDS_PRESCRIPTION: 'NEEDS_PRESCRIPTION',
  TOO_LONG: 'UNSCREENED',
};

/** Codes whose terms are NEVER skipped by the "no X" / "without X" rule ("not breathing", "no breath" and "no seizure" all trip). */
const NEVER_NEGATED: ReadonlySet<TermCode> = new Set(['EMERGENCY', 'BREATHING', 'STROKE']);

type Lang = 'en' | 'ar' | 'ckb';
type Terms = Readonly<Record<Lang, readonly string[]>>;
/** Two lists that trip only when a word of EACH appears in the same sentence ("pain ... in my chest"). */
type Together = Readonly<Partial<Record<Lang, readonly [readonly string[], readonly string[]]>>>;

export interface RedFlagEntry extends Terms {
  /** What the code means, for the reviewer. */
  readonly meaning: string;
  readonly together?: Together;
}

/**
 * HOW TO READ THIS TABLE (for the reviewing pharmacist)
 *  - Spelling does not matter much: every term is folded like the complaint (أ/ا, ة/ه, ی/ي, ە/ه, ك/ک, ڕ/ر, ڵ/ل, ێ/ي, ۆ/و,
 *    no diacritics, lower case).
 *  - English terms match at the START of a word, so "breath" covers "breathe", "breathing" and "breathless". An English term
 *    ending in `=` matches only the whole word ("temp=" is not "temporary").
 *  - Arabic and Kurdish terms match anywhere inside the text, and a space inside a term may be missing in the text
 *    ("هەناسە تەنگی" also matches "هەناسەتەنگی").
 *  - A term written `=word` matches only at the start of a word (after an optional و ف ب ل ک and ال); `=word=` matches only
 *    the whole word. Used for short words that hide inside longer ones (دم in عدم).
 *  - `together`: a word from the first list AND a word from the second list in the same sentence.
 *  - Negation: an English term directly after "no " or "without " is skipped ("no chest pain"), EXCEPT for EMERGENCY,
 *    BREATHING and STROKE, which are never skipped. Nothing else counts as a negation: "not", "denies", and every Arabic or
 *    Kurdish negation still trip. The rule refers when in doubt.
 *  - HIGH_FEVER_LONG lists FEVER words; it trips when a fever word (or a temperature of 39 or more) appears together with a
 *    duration of more than 3 days anywhere in the text. The temperature itself is not required: any fever of more than 3 days
 *    is referred, so a bare 39-45 after a fever word ("temp 40 for 5 days") needs no rule of its own.
 *  - INFANT_FEVER lists BABY words; it trips when a fever word (or a word from `INFANT_HOT_TERMS`, such as "hot") appears and
 *    the child is 3 months old or younger: from the age field when it is given, else from a baby word or an age written in
 *    the text.
 *  - PREGNANCY trips on any word below, or on the pregnancy field, with any complaint.
 *  - NEEDS_PRESCRIPTION is a "needs a prescription" referral, not a clinical red flag (see RED_FLAG_KIND): the answer names
 *    nothing and refers.
 */
export const RED_FLAG_TERMS: Readonly<Record<TermCode, RedFlagEntry>> = {
  EMERGENCY: {
    meaning: 'An emergency: severe allergic reaction or swelling of the tongue, lips or throat, seizure, fainting or unconsciousness, overdose, poisoning, self-harm, heavy bleeding',
    en: [
      'anaphyla', 'severe allergic', 'allergic shock', 'swollen tongue', 'swollen lips', 'swollen throat', 'throat is closing', 'throat closing', 'throat closed',
      'seizure', 'convuls', 'epileptic fit', 'faint', 'passed out', 'pass out', 'passing out', 'blacked out', 'unconscious', 'unresponsive', 'collapse',
      'overdose', 'took too many', 'too many pills', 'poison', 'swallowed bleach', 'drank bleach', 'swallowed chemical', 'drank chemical', 'swallowed a battery', 'drank kerosene',
      'suicid', 'self-harm', 'self harm', 'harm himself', 'harm herself', 'harm myself', 'kill himself', 'kill herself', 'kill myself', 'end my life', 'end his life', 'end her life',
      'heavy bleeding', 'bleeding heavily', 'severe bleeding', 'bleeding a lot', 'bleeding will not stop', "bleeding won't stop", "won't stop bleeding", 'will not stop bleeding', 'bleeding does not stop',
    ],
    ar: [
      'صدمة تحسسية', 'حساسية شديدة', 'حساسية قوية', 'تورم اللسان', 'تورم الشفاه', 'تورم الشفايف', 'تورم الحلق', 'تورم الوجه', 'انتفاخ اللسان', 'انتفاخ الوجه',
      'تشنج', 'صرع', 'إغماء', 'مغمى عليه', 'فقد الوعي', 'فقدان الوعي', 'فاقد الوعي', 'غائب عن الوعي',
      'جرعة زائدة', 'بلع حبوب كثيرة', 'تسمم', 'مسموم', 'شرب كلور', 'بلع كلور', 'شرب قاصر', 'شرب مادة كيميائية', 'بلع بطارية', 'شرب نفط',
      'انتحار', 'ينتحر', 'إيذاء النفس', 'يؤذي نفسه', 'تؤذي نفسها', 'نزيف شديد', 'نزيف قوي', 'نزيف حاد', 'نزيف لا يتوقف',
    ],
    ckb: [
      'هەستیاری توند', 'هەستیاری زۆر', 'ئاوسانی زمان', 'ئاوسانی لێو', 'ئاوسانی گەروو', 'ئاوسانی دەموچاو', 'گرژبوون', 'پەرکەم',
      'بێهۆش', 'لەهۆش چوو', 'هۆشی نەماوە', 'بورانەوە', 'دەرمانی زۆری خواردووە', 'ژەهراوی', 'ژەهر خواردن', 'کلۆر',
      'خۆکوشتن', 'خۆی بکوژێت', 'خۆم بکوژم', 'ئازاردانی خۆ', 'خوێنبەربوونی زۆر', 'خوێنبەربوونی توند', 'خوێن ناوەستێت',
    ],
    together: {
      en: [['swell', 'swollen'], ['tongue', 'lip', 'throat', 'face']],
      ar: [['تورم', 'متورم', 'انتفاخ', 'منفوخ', 'وارم'], ['لسان', 'شفا', 'شفه', 'شفايف', 'حلق', '=وجه']],
      ckb: [['ئاوس', 'پەنەمی'], ['زمان', 'لێو', 'گەروو', 'دەموچاو']],
    },
  },
  CHEST_PAIN: {
    meaning: 'Chest pain, pressure or tightness',
    en: ['chest pain', 'chest ache', 'chest tightness', 'tight chest', 'tightness in the chest', 'chest pressure', 'heart pain', 'angina', 'heart attack'],
    ar: ['ألم في الصدر', 'ألم بالصدر', 'ألم الصدر', 'وجع في الصدر', 'وجع الصدر', 'وجع بالصدر', 'ضيق في الصدر', 'ضيق بالصدر', 'ضغط على الصدر', 'ألم في القلب', 'وجع القلب', 'ذبحة صدرية', 'نوبة قلبية', 'جلطة قلبية'],
    ckb: ['ئازاری سنگ', 'ئێشی سنگ', 'ژانی سنگ', 'سنگ ئێشە', 'سنگم دێشێت', 'تەنگی سنگ', 'گوشار لەسەر سنگ', 'ئازاری دڵ', 'دڵ ئێشە', 'جەڵتەی دڵ'],
    together: {
      en: [['chest'], ['pain', 'ache', 'aching', 'hurt', 'tight', 'pressure', 'heavy', 'heaviness', 'squeez', 'crush']],
      ar: [['صدر'], ['=ألم', '=وجع', '=ضيق', '=ضغط', 'يوجع', 'توجع', '=ثقل']],
      ckb: [['سنگ'], ['ئازار', 'ئێش', 'ژان', 'دێش', 'تەنگ', 'گوشار', 'قورس']],
    },
  },
  BREATHING: {
    meaning: 'Trouble breathing, or breathing that has stopped',
    en: [
      'shortness of breath', 'short of breath', 'out of breath', 'breathless', 'no breath', 'not breathing', 'not breathe', 'stopped breathing', 'stop breathing',
      'difficulty breathing', 'trouble breathing', 'hard to breathe', "can't breathe", 'cant breathe', 'cannot breathe', 'can not breathe', 'struggling to breathe',
      'wheez', 'gasping', 'blue lips', 'lips are blue', 'blue in the face', 'turning blue', 'turned blue', 'went blue', 'choking',
    ],
    ar: [
      'ضيق تنفس', 'ضيق في التنفس', 'ضيق بالتنفس', 'ضيق النفس', 'صعوبة في التنفس', 'صعوبة التنفس', 'صعوبة بالتنفس', 'لا يستطيع التنفس', 'ما يقدر يتنفس', 'ما يكدر يتنفس',
      'لا يتنفس', 'ما يتنفس', 'توقف عن التنفس', 'توقف التنفس', 'انقطاع النفس', 'ازرق وجهه', 'ازرق لونه', 'ازرقاق',
      'نهجان', 'لهاث', 'اختناق', 'يختنق', 'كتمة',
    ],
    ckb: ['هەناسە تەنگی', 'تەنگە هەناسە', 'هەناسەی تەنگە', 'هەناسە بڕکێ', 'ناتوانێت هەناسە بدات', 'ناتوانم هەناسە بدەم', 'هەناسە نادات', 'هەناسەی وەستاوە', 'هەناسەی بڕاوە', 'شین بووەتەوە', 'شین هەڵگەڕاوە', 'خنکان'],
    together: {
      en: [['breath'], ['trouble', 'difficult', 'hard', 'short', 'struggl', 'problem', "can't", 'cant', 'cannot', 'unable', 'fast', 'rapid', 'heavy', 'labo', 'noisy']],
      ar: [['تنفس', '=نفس='], ['=ضيق', 'صعوب', '=صعب', 'مشكل', 'لا يقدر', 'ما يقدر', 'ما يكدر', 'لا يستطيع', '=سريع', '=ثقيل']],
      ckb: [['هەناسە'], ['تەنگ', 'قورس', 'سەخت', 'ناتوان', 'کێشە', 'خێرا', 'بڕکێ']],
    },
  },
  HIGH_FEVER_LONG: {
    meaning: 'Fever (above 39) for more than 3 days: these are the FEVER words, combined with a duration',
    en: ['fever', 'febrile', 'pyrexia', 'temperature', 'temp=', 'high temp', 'hot to the touch', 'burning up'],
    ar: ['=حمى=', '=الحمى=', 'سخونة', 'حرارة', 'حرارته', 'حرارتها', 'مسخن'],
    ckb: ['=تای=', '=تایە=', 'تا هەیە', 'تای هەیە', 'تای بەرز', 'تای زۆر', 'تاوی', 'گەرمی لەش', 'لەشی گەرمە', 'پلەی گەرمی', 'گەرمیەتی'],
  },
  BLOOD_IN_STOOL: {
    meaning: 'Blood in the stool, black or tarry stool, bleeding from the back passage',
    en: [
      'blood in stool', 'blood in the stool', 'blood in his stool', 'blood in her stool', 'bloody stool', 'bloody diarrh', 'blood in poo', 'blood in the poo', 'bloody poo',
      'pooping blood', 'pooped blood', 'poops blood', 'blood when pooping', 'blood after pooping', 'passing blood',
      'rectal bleeding', 'bleeding from the bottom', 'bleeding from the back passage', 'black stool', 'tarry stool', 'black tarry', 'melena', 'melaena',
    ],
    ar: ['دم في البراز', 'دم بالبراز', 'دم مع البراز', 'دم بالخروج', 'دم مع الخروج', 'براز دموي', 'براز اسود', 'إسهال دموي', 'نزيف من الشرج', 'نزيف شرجي'],
    ckb: ['خوێن لە پیسایی', 'خوێن لەگەڵ پیسایی', 'پیسایی خوێناوی', 'پیسایی ڕەش', 'سکچوونی خوێناوی', 'خوێنبەربوون لە کۆم'],
    together: {
      en: [['stool', 'poop', 'feces', 'faeces', 'bowel', 'diarrh', 'motions'], ['blood', 'bleed', 'black']],
      ar: [['براز', 'غائط', 'إسهال', 'الشرج', '=خروج'], ['=دم', 'نزيف', 'اسود']],
      ckb: [['پیسایی', '=گوو', 'سکچوون', 'ئاودەست', '=کۆم='], ['خوێن', '=ڕەش']],
    },
  },
  STROKE: {
    meaning: 'Signs of a stroke: face drooping, arm or leg weakness on one side, speech trouble, sudden confusion or vision loss',
    en: ['stroke', 'face droop', 'facial droop', 'drooping', 'mouth droop', 'crooked mouth', 'slurred', 'slurring', "can't speak", 'cannot speak', 'unable to speak', 'trouble speaking', 'sudden weakness', 'one side of the body', 'one side of his body', 'one side of her body', 'one-sided weakness', 'weakness on one side', 'numbness on one side', 'numb on one side', 'paralys', 'paralyz', 'sudden confusion', 'sudden loss of vision', 'sudden vision loss'],
    ar: ['جلطة', 'سكتة', 'شلل', 'تدلي الوجه', 'تدلي الفم', 'ميلان الفم', 'ميلان في الفم', 'ميلان الوجه', 'اعوجاج الفم', 'اعوجاج الوجه', 'ثقل في اللسان', 'ثقل اللسان', 'ثقل بالكلام', 'صعوبة في الكلام', 'صعوبة الكلام', 'لا يستطيع الكلام', 'ما يقدر يحكي', 'ما يكدر يحجي', 'ضعف في جهة', 'ضعف في نصف', 'خدر في نصف', 'تنميل في نصف', 'نصف الجسم', 'جهة واحدة من الجسم', 'فقدان البصر المفاجئ'],
    ckb: ['جەڵتە', 'سەکتە', 'ئیفلیج', 'پەککەوت', 'لاری دەم', 'دەمی لار', 'دەموچاوی لار', 'دەم و چاوی لار', 'زمانی قورس', 'قسەکردنی قورس', 'ناتوانێت قسە بکات', 'یەک لای لەش', 'نیوەی لەش', 'سڕبوونی یەک لا', 'لاوازی یەک لا'],
    together: {
      en: [['one side', 'one-side', 'left side', 'right side', 'half of'], ['weak', 'numb', 'tingl', "can't move", 'cannot move', 'unable to move', 'droop', 'paraly', 'heavy']],
      ar: [['=جهة', '=جانب', '=نصف', 'طرف واحد'], ['=ضعف', 'خدر', 'تنميل', 'لا يستطيع تحريك', 'ما يقدر يحرك', 'ما يكدر يحرك', '=ثقل', 'شلل']],
      ckb: [['یەک لا', 'لایەک', 'نیوەی'], ['لاواز', 'سڕ', 'ناتوان', 'بێهێز', 'قورس']],
    },
  },
  INFANT_FEVER: {
    meaning: 'A child of 3 months or younger with a fever: these are the BABY words, combined with a fever word',
    en: ['newborn', 'new born', 'new-born', 'neonat', 'infant', 'baby', 'babies'],
    ar: ['رضيع', 'حديث الولادة', 'حديثة الولادة', 'حديثي الولادة', 'مولود'],
    ckb: ['کۆرپە', 'ساوا', 'تازە لەدایکبوو', 'شیرەخۆر'],
  },
  PREGNANCY: {
    meaning: 'Pregnancy, with any complaint',
    en: ['pregnan', 'expecting', 'trimester'],
    ar: ['حامل', '=حمل=', 'حبلى', 'حوامل'],
    ckb: ['دووگیان', 'سکپڕ', 'منداڵی لە سکدایە'],
  },
  NEEDS_PRESCRIPTION: {
    meaning: 'Needs a prescription (not a clinical red flag): bacterial infection, antibiotics, a prescription',
    en: ['bacterial', 'bacteria', 'antibiotic', 'strep throat', 'prescription'],
    ar: ['بكتيري', 'مضاد حيوي', 'مضادات حيوية', 'وصفة طبية', 'روشتة', 'راشيتة'],
    ckb: ['بەکتری', 'بەکتیری', 'ئەنتیبایۆتیک', 'ئەنتی بایۆتیک', 'ڕاچێتە', 'نوسخە'],
  },
};

/** Words that mean "has a fever" only when said of a child of 3 months or younger ("baby 2 months hot"). */
export const INFANT_HOT_TERMS: Terms = {
  en: ['hot=', 'feels warm', 'warm to the touch'],
  ar: ['=حار=', '=سخن'],
  ckb: ['=گەرم'],
};

/**
 * Prescription-only active ingredients (Ruling 5): the main antibiotics and other prescription-only classes (opioids,
 * sedatives, gabapentinoids, steroids by mouth or injection, anticoagulants, insulin and diabetes tablets, heart and blood
 * pressure medicines, psychiatric and anti-epileptic medicines, isotretinoin, misoprostol, methotrexate, erectile-dysfunction
 * medicines), in English with common variants and brand-like names, and the main ones in Arabic and Kurdish. Task 6 and 9 drop
 * any model-named option that matches. This list is a floor, not the whole rule: the catalog's rxLevel decides as well.
 */
export const RX_ONLY_INGREDIENTS: readonly string[] = [
  // Antibiotics
  'amoxicillin', 'amoxycillin', 'amoxil', 'co-amoxiclav', 'amoxicillin-clavulanate', 'augmentin', 'ampicillin', 'penicillin', 'phenoxymethylpenicillin', 'flucloxacillin',
  'cefalexin', 'cephalexin', 'cefuroxime', 'ceftriaxone', 'cefixime', 'cefdinir', 'cefadroxil', 'azithromycin', 'zithromax', 'clarithromycin', 'erythromycin',
  'doxycycline', 'tetracycline', 'minocycline', 'ciprofloxacin', 'cipro', 'levofloxacin', 'moxifloxacin', 'ofloxacin', 'metronidazole', 'flagyl', 'tinidazole',
  'trimethoprim', 'co-trimoxazole', 'sulfamethoxazole', 'nitrofurantoin', 'clindamycin', 'gentamicin', 'amikacin', 'vancomycin', 'linezolid', 'fosfomycin', 'rifampicin',
  // Opioids, sedatives, gabapentinoids
  'tramadol', 'codeine', 'morphine', 'oxycodone', 'fentanyl', 'pethidine', 'diazepam', 'alprazolam', 'lorazepam', 'clonazepam', 'bromazepam', 'zolpidem', 'pregabalin', 'gabapentin',
  // Steroids by mouth or injection
  'prednisolone', 'prednisone', 'methylprednisolone', 'dexamethasone', 'betamethasone injection', 'triamcinolone injection',
  // Blood, diabetes, heart
  'warfarin', 'rivaroxaban', 'apixaban', 'clopidogrel', 'insulin', 'metformin', 'glibenclamide', 'gliclazide', 'amlodipine', 'atenolol', 'bisoprolol', 'lisinopril', 'losartan', 'atorvastatin', 'digoxin', 'furosemide',
  // Psychiatric, anti-epileptic
  'sertraline', 'fluoxetine', 'escitalopram', 'amitriptyline', 'olanzapine', 'quetiapine', 'risperidone', 'carbamazepine', 'valproate', 'sodium valproate', 'lamotrigine', 'levetiracetam',
  // Other
  'isotretinoin', 'misoprostol', 'methotrexate', 'levothyroxine', 'sildenafil', 'tadalafil', 'finasteride',
  // Arabic
  'أموكسيسيلين', 'اموكسيسيلين', 'أموكسيل', 'أوجمنتين', 'اوجمنتين', 'أمبيسيلين', 'بنسلين', 'سيفالكسين', 'سيفترياكسون', 'سيفيكسيم', 'أزيثرومايسين', 'ازيثرومايسين', 'زيثروماكس',
  'كلاريثرومايسين', 'إريثرومايسين', 'دوكسيسايكلين', 'سيبروفلوكساسين', 'سيبرو', 'ليفوفلوكساسين', 'ميترونيدازول', 'فلاجيل', 'كليندامايسين', 'جنتامايسين',
  'ترامادول', 'كودايين', 'مورفين', 'ديازيبام', 'ألبرازولام', 'بريجابالين', 'بريدنيزولون', 'ديكساميثازون', 'وارفارين', 'أنسولين', 'انسولين', 'ميتفورمين', 'إيزوتريتينوين', 'ميزوبروستول', 'سيلدينافيل',
  // Kurdish (Sorani)
  'ئەمۆکسیسیلین', 'ئۆگمێنتین', 'ئەزیسرۆمایسین', 'سیپرۆفلۆکساسین', 'مێترۆنیدازۆڵ', 'فلاجیل', 'دۆکسیسایکلین', 'سێفتریاکسۆن', 'سێفالێکسین',
  'ترامادۆڵ', 'کۆدایین', 'دیازێپام', 'پرێگابالین', 'پرێدنیزۆلۆن', 'دێکسامیسازۆن', 'وارفارین', 'ئینسولین', 'مێتفۆرمین',
];

// Compiling the table ---------------------------------------------------------------------------------------------------

const LETTER = '\\p{L}\\p{M}';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Matcher {
  re: RegExp;
  /** English terms of most codes may be negated by a directly preceding "no " or "without ". */
  negatable: boolean;
}

function compileTerm(raw: string, lang: Lang, negatable: boolean): Matcher {
  if (lang === 'en') {
    const whole = raw.length > 1 && raw.endsWith('=');
    const body = escape(normalizeForScreening(whole ? raw.slice(0, -1) : raw)).replace(/ /g, '\\s*');
    return { re: new RegExp(`(?<![a-z])${body}${whole ? '(?![a-z])' : ''}`, 'gu'), negatable };
  }
  const start = raw.startsWith('=');
  const whole = start && raw.length > 2 && raw.endsWith('=');
  const word = normalizeForScreening(raw.slice(start ? 1 : 0, whole ? -1 : undefined));
  const body = escape(word).replace(/ /g, '\\s?');
  const left = start ? `(?<![${LETTER}])(?:[وفبلک])?(?:ال)?` : '';
  const right = whole ? `(?![${LETTER}])` : '';
  return { re: new RegExp(`${left}${body}${right}`, 'gu'), negatable: false };
}

const compileList = (lists: Terms, negatable: boolean): Matcher[] => (['en', 'ar', 'ckb'] as const).flatMap((lang) => lists[lang].map((t) => compileTerm(t, lang, negatable)));

interface CompiledEntry {
  terms: Matcher[];
  together: Array<[Matcher[], Matcher[]]>;
}

const COMPILED: Readonly<Record<TermCode, CompiledEntry>> = Object.fromEntries(
  TERM_CODES.map((code) => {
    const entry = RED_FLAG_TERMS[code];
    const negatable = !NEVER_NEGATED.has(code);
    const together = (['en', 'ar', 'ckb'] as const).flatMap((lang): Array<[Matcher[], Matcher[]]> => {
      const pair = entry.together?.[lang];
      return pair ? [[pair[0].map((t) => compileTerm(t, lang, negatable)), pair[1].map((t) => compileTerm(t, lang, negatable))]] : [];
    });
    return [code, { terms: compileList(entry, negatable), together }];
  }),
) as Record<TermCode, CompiledEntry>;
const INFANT_HOT = compileList(INFANT_HOT_TERMS, true);

const NEGATED_BEFORE = /(?:^|[^a-z])(?:no|without)\s+$/;

/** Whether the matcher finds at least one occurrence in `text` that is not plainly negated. */
function hits(m: Matcher, text: string): boolean {
  for (const found of text.matchAll(m.re)) {
    const at = found.index ?? 0;
    if (!m.negatable || !NEGATED_BEFORE.test(text.slice(Math.max(0, at - 12), at))) return true;
  }
  return false;
}

const anyHit = (list: readonly Matcher[], text: string) => list.some((m) => hits(m, text));

/** Sentences for the `together` lists: split on sentence punctuation and line breaks, never on a decimal point. */
const sentencesOf = (text: string) => text.split(/[!?؟;\n]|\.(?!\d)/);

function entryHits(code: TermCode, text: string, sentences: readonly string[]): boolean {
  const c = COMPILED[code];
  if (anyHit(c.terms, text)) return true;
  return c.together.some(([a, b]) => sentences.some((s) => anyHit(a, s) && anyHit(b, s)));
}

// Numbers: durations, temperatures, ages ---------------------------------------------------------------------------------
// Every pattern that captures digits starts with NUM: it cannot start inside a run of digits ("12345") or right after a
// decimal point ("39.5"), so a long run of digits is read in one pass, never once per digit (which was quadratic).

const NUM = '(?<!\\d)(?<!\\d\\.)';
/** Words compiled the way the table is (folded), joined as a regex alternation. */
const alt = (words: readonly string[]) => words.map((w) => escape(normalizeForScreening(w)).replace(/ /g, '\\s?')).join('|');
const ARABIC_START = `(?<![${LETTER}])(?:[وفبلک])?(?:ال)?`;

const EN_DAYS = new RegExp(`${NUM}(\\d+(?:\\.\\d+)?)\\s*-?\\s*(?:days?|d)(?![a-z])`, 'g');
const EN_LONG = /(?<![a-z])(?:weeks?|wks?|months?|fortnight)(?![a-z])(?!\s*-?\s*old)/;
const EN_WORD_DAYS = /(?<![a-z])(?:four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|several|many)\s+days/;
const AR_DAYS = new RegExp(`${NUM}(\\d+)\\s*(?:${alt(['يوم', 'أيام'])})`, 'gu');
const AR_LONG = new RegExp(`${ARABIC_START}(?:${alt(['أسبوع', 'أسابيع', 'شهر', 'شهور', 'أشهر'])})`, 'u');
const AR_WORD_DAYS = new RegExp(`${ARABIC_START}(?:${alt(['أربع', 'خمس', 'ست', 'سبع', 'ثمان', 'تسع', 'عشر', 'عدة'])})[${LETTER}]{0,4}\\s?(?:${alt(['أيام', 'يوم'])})`, 'u');
const CKB_DAYS = new RegExp(`${NUM}(\\d+)\\s*(?:${alt(['ڕۆژ'])})`, 'gu');
const CKB_LONG = new RegExp(`(?:${alt(['هەفتە', 'مانگ'])})`, 'u');
const CKB_WORD_DAYS = new RegExp(`(?<![${LETTER}])(?:${alt(['چوار', 'پێنج', 'شەش', 'حەوت', 'هەشت', 'نۆ', 'دە', 'چەند'])})\\s?(?:${alt(['ڕۆژ'])})`, 'u');

const anyNumberOver = (re: RegExp, text: string, limit: number) => {
  for (const m of text.matchAll(re)) if (Number(m[1]) > limit) return true;
  return false;
};

/**
 * A duration of MORE than 3 days anywhere in the text: "N days" with N > 3, any number of weeks or months, a week or month
 * word, "five days", "several days". In en, ar and ckb. "3 days", "2.5 days" and "يومين" (two days) do not count.
 */
export function mentionsOver3Days(text: string): boolean {
  return (
    anyNumberOver(EN_DAYS, text, 3) || EN_LONG.test(text) || EN_WORD_DAYS.test(text) ||
    anyNumberOver(AR_DAYS, text, 3) || AR_LONG.test(text) || AR_WORD_DAYS.test(text) ||
    anyNumberOver(CKB_DAYS, text, 3) || CKB_LONG.test(text) || CKB_WORD_DAYS.test(text)
  );
}

/** A temperature reading of 39 to 45 (Celsius) or 102 to 113 (Fahrenheit): a number followed by a degree sign or word. */
const TEMP = new RegExp(`${NUM}(\\d+(?:\\.\\d+)?)\\s*(°|º|degrees?(?![a-z])|c(?![a-z])|f(?![a-z])|${alt(['درجة', 'پلە'])})`, 'gu');
function highTemperature(text: string): boolean {
  for (const m of text.matchAll(TEMP)) {
    const v = Number(m[1]);
    if ((v >= 39 && v <= 45) || (m[2] === 'f' && v >= 102 && v <= 113)) return true;
  }
  return false;
}

const EN_AGE = new RegExp(`${NUM}(\\d+)\\s*-?\\s*(days?|weeks?|wks?|months?)\\s*-?\\s*old`, 'g');
/** An age right after a word for a child, without "old" ("baby 2 months", "my son is 6 weeks"). */
const EN_AGE_NEAR = new RegExp(`(?<![a-z])(?:bab(?:y|ies)|infant|newborn|child|kid|son|daughter|boy|girl)\\D{0,15}?${NUM}(\\d+)\\s*-?\\s*(days?|weeks?|wks?|months?)(?![a-z])`, 'g');
const EN_AGE_WORDS = /(?<![a-z])(?:a|one|two|three)\s*-?\s*(?:days?|weeks?|months?)\s*-?\s*old/;
const AR_AGE = new RegExp(`${alt(['عمر'])}[${LETTER}]{0,4}\\s?(?:(\\d+)\\s*)?(${alt(['يوم', 'أيام', 'أسبوع', 'أسابيع', 'شهرين', 'شهر', 'أشهر', 'شهور'])})`, 'gu');
const CKB_AGE = new RegExp(`${alt(['تەمەن'])}[${LETTER}]{0,4}\\s?(?:(\\d+)\\s*)?(${alt(['ڕۆژ', 'هەفتە', 'مانگ'])})`, 'gu');
const MONTH_UNITS = new Set(['month', 'months', ...['شهر', 'أشهر', 'شهور', 'مانگ'].map(normalizeForScreening)]);
const TWO_MONTHS = normalizeForScreening('شهرين');
const WEEK_PREFIXES = ['أسبوع', 'أسابيع'].map(normalizeForScreening);

/** An age written in the text that is 3 months or younger ("2 month old", "baby 2 months", "عمره شهرين", "تەمەن 3 هەفتە"). */
export function mentionsAgeUpTo3Months(text: string): boolean {
  if (EN_AGE_WORDS.test(text)) return true;
  for (const re of [EN_AGE, EN_AGE_NEAR, AR_AGE, CKB_AGE]) {
    for (const m of text.matchAll(re)) {
      const unit = m[2];
      const n = m[1] === undefined ? (unit === TWO_MONTHS ? 2 : 1) : Number(m[1]);
      if (unit === TWO_MONTHS || MONTH_UNITS.has(unit)) {
        if (n <= 3) return true;
      } else if (/week|wk|هفته/u.test(unit) || WEEK_PREFIXES.some((p) => unit.startsWith(p))) {
        if (n <= 13) return true;
      } else if (n <= 92) {
        return true; // days
      }
    }
  }
  return false;
}

// The screen ------------------------------------------------------------------------------------------------------------

/** A text longer than this is not screened in full: it refers as TOO_LONG (its first part and its end are still screened). */
export const SCREEN_MAX_CHARS = 20_000;
/** The screen reads overlapping windows of this size, so the work grows with the length of the text and nothing is skipped. */
const WINDOW = 4_000;
const OVERLAP = 400;
const TAIL = 1_000;

export interface ScreenInput {
  text: string;
  /** From the form; ignored unless a finite number from 0 to 130. */
  ageYears?: number;
  pregnant?: boolean;
}

export interface ScreenResult {
  mustRefer: boolean;
  /** Each code once, in the order of `RED_FLAG_CODES`. */
  reasons: RedFlagCode[];
}

const validAge = (age: number | undefined): age is number => typeof age === 'number' && Number.isFinite(age) && age >= 0 && age <= 130;

function windowsOf(raw: string): string[] {
  const head = raw.slice(0, SCREEN_MAX_CHARS);
  const out: string[] = [];
  for (let i = 0; ; i += WINDOW - OVERLAP) {
    out.push(head.slice(i, i + WINDOW));
    if (i + WINDOW >= head.length) break;
  }
  if (raw.length > SCREEN_MAX_CHARS) out.push(raw.slice(-TAIL));
  return out;
}

function screenWindow(raw: string, age: number | undefined, found: Set<RedFlagCode>): void {
  const text = normalizeForScreening(raw);
  const sentences = sentencesOf(text);
  for (const code of ['EMERGENCY', 'CHEST_PAIN', 'BREATHING', 'BLOOD_IN_STOOL', 'STROKE', 'PREGNANCY', 'NEEDS_PRESCRIPTION'] as const) {
    if (!found.has(code) && entryHits(code, text, sentences)) found.add(code);
  }
  const fever = entryHits('HIGH_FEVER_LONG', text, sentences) || highTemperature(text);
  if (fever && mentionsOver3Days(text)) found.add('HIGH_FEVER_LONG');
  if (fever || anyHit(INFANT_HOT, text)) {
    // The age field wins over baby WORDS when it says older than 3 months; an age written in the text always counts.
    const infantByField = age !== undefined && age <= 0.25;
    const infantByWord = age === undefined && entryHits('INFANT_FEVER', text, sentences);
    if (infantByField || infantByWord || mentionsAgeUpTo3Months(text)) found.add('INFANT_FEVER');
  }
}

/**
 * The deterministic red-flag screen. Pure and total: any string (hostile, huge, mixed scripts) gets an answer in time that
 * grows with its length, and text inside the complaint can never switch a rule off, because nothing in it is read as an
 * instruction, only matched against the table. Up to SCREEN_MAX_CHARS the whole text is screened (in overlapping windows; a
 * fever word and its duration must then fall within one 4,000-character window). A longer text also refers as TOO_LONG.
 */
export function screenComplaint(input: ScreenInput): ScreenResult {
  const raw = typeof input.text === 'string' ? input.text : '';
  const age = validAge(input.ageYears) ? input.ageYears : undefined;
  const found = new Set<RedFlagCode>();
  for (const part of windowsOf(raw)) screenWindow(part, age, found);
  if (input.pregnant === true) found.add('PREGNANCY');
  if (raw.length > SCREEN_MAX_CHARS) found.add('TOO_LONG');

  const reasons = RED_FLAG_CODES.filter((c) => found.has(c));
  return { mustRefer: reasons.length > 0, reasons };
}

// Answers ---------------------------------------------------------------------------------------------------------------

/** Limits re-checked on every answer. A reply over a limit is refused, never cut (a cut warning can change its meaning). */
const LINE = z.string().max(400);
const LIST = z.array(LINE).max(12);
const NAME = z.string().max(200);

/** Keys in this order: red flags first. */
export const complaintAnswerSchema = z
  .object({
    redFlags: LIST,
    likelyCauses: LIST,
    askNext: LIST,
    options: z.array(z.object({ ingredient: NAME, tradeNames: z.array(NAME).max(8), note: LINE }).strict()).max(8),
    tellCustomer: LIST,
    referIf: LIST,
    cautions: LIST,
    unsure: z.boolean(),
  })
  .strict();
export type ComplaintAnswer = z.infer<typeof complaintAnswerSchema>;
export type ComplaintOption = ComplaintAnswer['options'][number];

export const medicineAnswerSchema = z
  .object({
    productName: NAME,
    activeIngredient: NAME,
    uses: LIST,
    doseAsLabelled: z.string().max(600),
    contraindications: LIST,
    interactions: LIST,
    sideEffects: LIST,
    warnings: LIST,
    storage: LINE,
    confident: z.boolean(),
  })
  .strict();
export type MedicineAnswer = z.infer<typeof medicineAnswerSchema>;
export type DoctorAnswer = ComplaintAnswer | MedicineAnswer;

const objectOf = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const strings = { type: 'array', items: { type: 'string' } };

/**
 * The same shapes for the provider (strict structured output): every property required, no extra keys, and NO limits
 * (strict mode rejects maxLength/maxItems), so the limits live in the Zod schemas, which re-check every answer.
 */
export const complaintAnswerJsonSchema = objectOf({
  redFlags: strings,
  likelyCauses: strings,
  askNext: strings,
  options: { type: 'array', items: objectOf({ ingredient: { type: 'string' }, tradeNames: strings, note: { type: 'string' } }) },
  tellCustomer: strings,
  referIf: strings,
  cautions: strings,
  unsure: { type: 'boolean' },
});

export const medicineAnswerJsonSchema = objectOf({
  productName: { type: 'string' },
  activeIngredient: { type: 'string' },
  uses: strings,
  doseAsLabelled: { type: 'string' },
  contraindications: strings,
  interactions: strings,
  sideEffects: strings,
  warnings: strings,
  storage: { type: 'string' },
  confident: { type: 'boolean' },
});

/** The JSON schema for a mode, ready for `AiRequest.jsonSchema`. */
export const answerJsonSchemaFor = (mode: DoctorMode): Record<string, unknown> => (mode === 'COMPLAINT' ? complaintAnswerJsonSchema : medicineAnswerJsonSchema);

export type FinalizeResult<T extends DoctorAnswer = DoctorAnswer> = { ok: true; answer: T } | { ok: false; code: 'INVALID' | 'EMPTY' };

/**
 * A code, not prose: put in `referIf` when an unsure complaint answer gave no referral of its own. The app maps it to its
 * translated generic "see a doctor" line (Task 8).
 */
export const REFER_GENERIC = '__REFER_GENERIC__';

const lines = (list: readonly string[]) => list.map((s) => s.trim()).filter((s) => s.length > 0);

function finalizeComplaint(a: ComplaintAnswer): FinalizeResult<ComplaintAnswer> {
  const redFlags = lines(a.redFlags);
  const referIf = lines(a.referIf);
  const options = a.options
    .map((o) => ({ ingredient: o.ingredient.trim(), tradeNames: lines(o.tradeNames), note: o.note.trim() }))
    .filter((o) => o.ingredient.length > 0 || o.tradeNames.length > 0);
  if (options.length === 0 && !a.unsure && referIf.length === 0 && redFlags.length === 0) return { ok: false, code: 'EMPTY' };
  return {
    ok: true,
    answer: {
      redFlags,
      likelyCauses: lines(a.likelyCauses),
      askNext: lines(a.askNext),
      // A red flag overrides any product suggestion; an unsure answer never guesses one.
      options: redFlags.length > 0 || a.unsure ? [] : options,
      tellCustomer: lines(a.tellCustomer),
      // An unsure answer always refers: when the model gave no reason, the app shows its generic "see a doctor" line.
      referIf: a.unsure && referIf.length === 0 ? [REFER_GENERIC] : referIf,
      cautions: lines(a.cautions),
      unsure: a.unsure,
    },
  };
}

function finalizeMedicine(a: MedicineAnswer): FinalizeResult<MedicineAnswer> {
  const answer: MedicineAnswer = {
    productName: a.productName.trim(),
    activeIngredient: a.activeIngredient.trim(),
    uses: lines(a.uses),
    doseAsLabelled: a.doseAsLabelled.trim(),
    contraindications: lines(a.contraindications),
    interactions: lines(a.interactions),
    sideEffects: lines(a.sideEffects),
    warnings: lines(a.warnings),
    storage: a.storage.trim(),
    confident: a.confident,
  };
  if (!answer.confident) {
    // Not sure what the product is: nothing about uses or doses may be shown, only the name read and the warnings.
    return {
      ok: true,
      answer: { productName: answer.productName, activeIngredient: '', uses: [], doseAsLabelled: '', contraindications: [], interactions: [], sideEffects: [], warnings: answer.warnings, storage: '', confident: false },
    };
  }
  const nothing = [answer.uses, answer.contraindications, answer.interactions, answer.sideEffects, answer.warnings].every((l) => l.length === 0) && answer.doseAsLabelled === '' && answer.storage === '';
  if (answer.productName === '' || answer.activeIngredient === '' || nothing) return { ok: false, code: 'EMPTY' };
  return { ok: true, answer };
}

/**
 * What the model returned (an object, or the JSON text of one), checked against the mode's strict schema. Non-JSON, a missing
 * or extra field, a wrong type or a value over a limit is INVALID; an answer with nothing to act on is EMPTY. Blank strings are
 * dropped, `redFlags` is the first key, and red flags or "unsure" empty the options.
 */
export function finalizeAnswer(raw: unknown, mode: 'COMPLAINT'): FinalizeResult<ComplaintAnswer>;
export function finalizeAnswer(raw: unknown, mode: 'MEDICINE_NAME' | 'MEDICINE_PHOTO'): FinalizeResult<MedicineAnswer>;
export function finalizeAnswer(raw: unknown, mode: DoctorMode): FinalizeResult;
export function finalizeAnswer(raw: unknown, mode: DoctorMode): FinalizeResult {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, code: 'INVALID' };
    }
  }
  if (mode === 'COMPLAINT') {
    const parsed = complaintAnswerSchema.safeParse(value);
    return parsed.success ? finalizeComplaint(parsed.data) : { ok: false, code: 'INVALID' };
  }
  const parsed = medicineAnswerSchema.safeParse(value);
  return parsed.success ? finalizeMedicine(parsed.data) : { ok: false, code: 'INVALID' };
}
