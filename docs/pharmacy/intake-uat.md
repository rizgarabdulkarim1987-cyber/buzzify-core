# Invoice by photo: owner acceptance on real invoices (UAT)

Phase 5 is built and tested on 50 **synthetic** invoices with a scripted model
(`tests/pharmacy/acceptance-phase-5.test.ts`). That proves the pipeline: nothing is completed, a draft is all an approval makes,
a repeat is refused, an outage leaves manual entry open, the budget stops spending. It cannot prove that a real model reads
**your** suppliers' paper well. That is this checklist. Spec section 12, row 5, is the bar:

> 50 real invoices: no guessed field; draft only; duplicates detected; an AI outage still allows manual entry; the budget stops spending.

The first three need real paper. The last two are proven by the tests **with a scripted model on synthetic invoices**, which shows the
pipeline behaves, not that your real provider fails or bills the way the tests assume: re-check both once on the real provider (step 6).
The budget in particular is a control with a bounded overshoot (a reading that costs more than its reservation is booked in full),
not a promise that a month is never overspent.

## 1. Prerequisites

| What | Where | Notes |
|---|---|---|
| Private R2 bucket for invoices | Cloudflare | A **separate** bucket from the media one, private, with a lifecycle rule that deletes objects after 31 days (a safety net for the orphan a crash can leave). |
| `PH_INTAKE_R2_ACCOUNT_ID`, `PH_INTAKE_R2_ACCESS_KEY_ID`, `PH_INTAKE_R2_SECRET_ACCESS_KEY`, `PH_INTAKE_R2_BUCKET` | Vercel / host env | All four or none. The bucket name must differ from `R2_BUCKET`. Without them upload is off (`INTAKE_STORAGE_NOT_CONFIGURED`); it never falls back to the public bucket. |
| An AI provider key | Studio super admin settings, or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | `AI_PROVIDER=fake` and `AI_PROVIDER=scripted` are refused in production and on a deployment. |
| `AI_PRICE_INPUT_USD_MICRO_PER_MTOK`, `AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK`, `AI_PRICE_MODEL` | env | Micro-dollars per million tokens, from the provider's price page on the day, and the **model id those prices are for** (the same id as `AI_MODEL_EXTRACT` or `AI_OPENAI_MODEL_EXTRACT`). **There is no default**: any of the three unset means `AI_PRICING_NOT_SET`, and a model that differs from `AI_PRICE_MODEL` means `AI_PRICING_MODEL_MISMATCH`; intake refuses to run in both (the safe state). Change the model and the prices together. |
| A plan with `limits.aiMonthlyBudgetMinor` | Studio, plans of the `pharmacy` application | **USD cents** (1,000 = 10 USD per month). 0 or missing means `AI_NOT_IN_PLAN`. Start with 2,000 for this test. |
| `Application(pharmacy)` ACTIVE | Studio | It ships DISABLED. |
| Staff | `/pharmacy` people | A pharmacist in charge, branch manager or owner can upload, read and edit. A stock clerk or accountant can only view and approve a clean batch (decision D4 below). |
| Disk | | For the evaluation script, a folder with the files and `truth.csv` (section 4). |

## 2. The 50 invoices

Collect real invoices from your real suppliers. Mix on purpose; the point is the hard ones:

- 20 phone photos, good light, flat on a table.
- 8 phone photos in bad light (yellow bulb, shadow of the hand, glare on glossy paper).
- 5 photos taken at an angle, or with a fold or a stamp over the text.
- 5 Arabic-only invoices, 5 English-only, 5 mixed Arabic and English (Sorani Kurdish is **not** a supported set; try 2 and record the result, do not count them).
- 7 PDFs (the supplier's own PDF export; scanned PDFs too). A PDF that is linearised, saved incrementally, or compressed in object streams is refused (`PDF_UNREADABLE`): record those, they are the cost of the page-count rule.
- 4 deliberately bad photos (blur, dark, tiny): the quality gate must refuse them **before** any spending (`REJECTED_QUALITY`, retake hint).
- 3 invoices with a line discount or tax, 3 with more than 60 lines, 2 with handwriting.
- Include at least 3 invoices you will upload **twice** (same photo; then a re-photo of the same paper) to see the duplicate handling.

Keep the paper. A person must read each one against the screen, so schedule a day, not an hour.

## 3. What to record per invoice

Copy this into a sheet, one row per file.

| Column | Meaning |
|---|---|
| file | name as saved |
| kind | photo / PDF; Arabic / English / mixed; good / bad light |
| gate | accepted, or the reason code it was refused with (BLURRY, TOO_SMALL, TOO_DARK, LOW_CONTRAST) and whether the refusal was fair |
| read | EXTRACTED / FAILED with the code |
| seconds | from pressing Read to the lines appearing |
| cost (USD) | from the usage card, before and after |
| fields wrong | a value on screen that is not what the paper says (the model read it badly) |
| null that should have been read | the paper has a value and the screen shows a blank (safe, but costs a keystroke) |
| **guessed** | the screen shows a value where the paper has **nothing** (invented or completed). **Must be 0 on all 50.** |
| lines missed / added | line count on screen against paper |
| match | lines the system matched by itself / lines you had to choose |
| minutes to approve | your time from open to DRAFT receipt |
| notes | anything odd |

## 4. The evaluation script (faster than reading by hand)

For a folder of invoices where you have typed the truth once, the script runs the real pipeline and prints, per field, how
many cells were CORRECT, NULL_CORRECT, NULL_MISSED, WRONG and GUESSED, the AI cost and the p95 time.

```sh
# a local test database only; the script refuses production, a deployment, and any database not on this machine ending in test or eval
BUZZIFY_DB_PORT=<port> DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:<port>/buzzify_test \
AI_PRICE_INPUT_USD_MICRO_PER_MTOK=<n> AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK=<n> AI_PRICE_MODEL=<model id> ANTHROPIC_API_KEY=<key> \
npx tsx scripts/pharmacy-intake-eval.ts <folder> --budget-cents 3000 --i-know-this-is-not-production
```

`<folder>/truth.csv` has the columns `file, supplierName, invoiceNumber, invoiceDate, currency, total, lines`. `lines` is one
JSON array per file: `[{"name":"Panadol","strength":"500 mg","form":"tablet","pack":"10 tablets","quantity":10,"bonus":null,"unitCost":1000,"lineTotal":10000,"lot":"A12","expiry":"2028-03"}]`.
Money is in minor units (whole dinars for IQD, cents for USD). **Leave a cell empty or omit the key when the paper has nothing
there**; that is what makes `GUESSED` mean something. Lines are compared by position.

Exit code: 1 when any GUESSED cell exists (the criterion), 2 when a file could not be read at all, 3 when it refused to run.
The script makes a throwaway business and deletes it at the end (`--keep` keeps it); files go to the system temp folder. It
tests the **reading**, not the matching, the review screen or the approval (do those by hand on at least 10 of the 50).

## 5. Pass criteria (spec 12 row 5, exactly)

1. **No guessed field.** GUESSED = 0 over the 50. One guess fails the phase: report it with the invoice and the field, we fix the prompt or the rule, and the 50 run again.
2. **Draft only.** After approving, there is a DRAFT receipt and **no stock moved** (check the stock screen and the movements for 3 invoices). Confirming the receipt on the normal screen is what brings stock in.
3. **Duplicates detected.** The repeated uploads: same photo is one file (no second charge); a second batch of the same paper is refused at approval with `DUPLICATE_INVOICE`, naming the earlier one; a differently spelled number (`inv-12 ` against `INV-12`) is still refused.
4. **An AI outage still allows manual entry.** Turn the provider key off (or set the budget to 1 cent) for one batch: files show FAILED with the code, "Enter manually" opens the ordinary receive screen, and once the key is back, Try again reads the file once and charges once.
5. **The budget stops spending.** Set the budget so that about 5 more invoices fit, upload 10: the later ones are refused `AI_BUDGET_REACHED` and the usage card never shows spent plus reserved above the budget.

Also record: median and p95 seconds per invoice; average cost per invoice (it sets the plan price); minutes saved against typing.

## 6. Re-check on the real provider

- The usage card (`/pharmacy/purchasing/intake`) against the provider's own dashboard for the same hour: they should agree within a few percent. If the provider bills more, adjust `AI_PRICE_*` upward before launch.
- One invoice read while another is being read, in two browsers: both finish, spending adds up.

## 7. What to recalibrate with real data

| Constant | Where | Starting value | Symptom, and what to change |
|---|---|---|---|
| Image quality limits | `QUALITY_LIMITS` in `src/server/domain/pharmacy/intake.ts` | sharpness 0.2, short side 800 px, mean luma 50, contrast 25 | Good photos refused (`BLURRY`, `LOW_CONTRAST`): lower the limit. Blurry photos accepted and read badly: raise it. A page with fewer than about 4 text rows reads as low contrast. All limits were measured on synthetic pages only. |
| Token constants | the input-token bounds in `src/server/domain/pharmacy/intake.ts` | image and PDF bounds | Compare `PhAiCall.inputTokens` (what the provider reported) with the bound the runner reserved. If the bound is far above the truth, the budget stops early (too cautious); if below, the runner books the overrun and audits it. Tune to about 10 to 20 percent above the real figure. |
| Output cap | `MAX_OUTPUT_TOKENS` 32,000 and the per-file cap `min(24000, 2000 + 8000 x pages)` in `extract.ts` | | `EXTRACTION_TRUNCATED` on an invoice with fewer than 200 lines: raise the cap. The cap also sets the worst-case reservation, so raising it lowers how many invoices a budget holds at once. |
| Line limit | 200 per file (`TOO_MANY_LINES`) | | A real invoice above 200 lines must be split into photos or entered by hand. |

## 8. Decisions this test must settle

- **D1. DD/MM dates.** A printed `03/04/2027` is read **day first** (3 April), and `03/2027` as month/year; the reader does not detect an invoice that writes month first (it would read `04/03/2027` as 4 March when the paper means 3 April, and a month above 12 as no date at all). Count how many of your real dates are month-first, and say whether any supplier writes that way; if so the rule must be per supplier. A date that cannot be read stays empty and the line is flagged, never guessed.
- **D2. Arabic and Kurdish search under the Neon locale.** The trigram step of matching finds nothing for Arabic letters when the database ctype is C. On a Neon branch of production run `SHOW lc_ctype` (needs UTF-8) and `CREATE EXTENSION IF NOT EXISTS pg_trgm`; then upload an invoice with Arabic product names that do not match exactly and check candidates appear. Exact barcode and exact name match work either way.
- **D3. Image barcode decoding (zxing).** The model does not read barcodes; the screen takes GS1 text typed or scanned by a keyboard-wedge scanner. If your invoices print barcodes you want read from the photo, test on 10 real photos whether a decoder is worth building. Not built.
- **D4. Who may edit.** A stock clerk or accountant can approve a clean batch but every edit control is disabled for them (they lack `ai.use`). Decide if that is intended or whether they should edit too.
- **D5. Discounts and tax.** Line and header discounts and tax are **not** folded into the receipt cost. A discounted line shows `MATH_MISMATCH` and is accepted with a reason at the printed pre-discount cost. A header discount or tax is stopped by `HEADER_ADJUSTMENT` until a person acknowledges, with a reason, that the receipt cost does not include it. If most of your suppliers print discounts, folding them into the cost must be built before launch. Related: an unprinted bonus is read as 0 by definition.
- **D6. Arabic and Kurdish wording.** All ar and ckb text is machine-drafted. Have a native speaker read the intake screens and the refusal sentences.

## 9. Retention and scheduling (launch steps)

Files are kept 30 days, then deleted from the bucket (the lines read stay as history). Nothing runs by itself yet; schedule all three daily:

```sh
npx tsx scripts/pharmacy-intake-purge.ts     # deletes files older than 30 days from the private bucket, marks them PURGED; prints counts only
npx tsx scripts/pharmacy-intake-expire.ts    # cancels batches left open 30 days or more (and deletes their files); [--days N]
npx tsx scripts/pharmacy-intake-sweep.ts     # books the AI reservations of dead workers as spend, for every business; prints counts only
```

Both need the four `PH_INTAKE_R2_*` variables and the production `DATABASE_URL`; both print counts and exit 1 when a deletion
failed (run again). A request-time sweep (every upload and reading) only covers the caller's own business, so the sweep script is what covers a business nobody is using. Purge and expire also release a file stuck in reading (its 10-minute lease ran out).
In the bucket, keep the 31-day lifecycle rule as a net under the purge.

## 10. Report back

Send the sheet, the script output, and your answers to D1 to D6. The phase is accepted when criteria 1 to 5 hold on the real
50 and D1 to D6 each have an answer (even "later").

---

## ملخص بالعربية

**ما الذي نختبره؟** المرحلة 5 (الفاتورة بالصورة) مبنية ومُختبرة على 50 فاتورة **اصطناعية**. هذا يثبت سلامة المسار، لكن لا يثبت جودة قراءة نموذج حقيقي لفواتير موردينكم الفعليين. هذا الاختبار على 50 فاتورة حقيقية.

**المتطلبات المسبقة:** حاوية R2 خاصة منفصلة للفواتير مع أربعة متغيرات `PH_INTAKE_R2_*`؛ مفتاح مزوّد الذكاء الاصطناعي؛ أسعار الرموز `AI_PRICE_INPUT_USD_MICRO_PER_MTOK` و`AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK` مع `AI_PRICE_MODEL` (معرّف النموذج الذي تخصّه الأسعار؛ لا قيمة افتراضية: بدون أيٍّ منها، أو إذا اختلف النموذج، يتوقف المسار)؛ خطة فيها `aiMonthlyBudgetMinor` بالسنت الأمريكي؛ وتفعيل تطبيق الصيدلية.

**الفواتير:** صور بإضاءة جيدة وسيئة وبزاوية مائلة، عربية وإنجليزية ومختلطة، وملفات PDF، وأربع صور سيئة عمداً (يجب أن يرفضها فحص الجودة قبل أي صرف)، وفواتير مكررة عمداً.

**ما يُسجَّل لكل فاتورة:** الحقول الخاطئة، والحقول الفارغة التي كان يجب قراءتها، و**الحقول المخمَّنة** (قيمة ظهرت حيث لا شيء على الورق)، والزمن، والكلفة، وعدد السطور، والأسطر التي طابقها النظام وحده.

**معايير النجاح (القسم 12 الصف 5):** (1) **صفر حقل مخمَّن** من 50؛ (2) مسودة فقط ولا حركة مخزون حتى يُؤكَّد الإيصال؛ (3) كشف التكرار (الصورة نفسها ملف واحد، والفاتورة نفسها تُرفض عند الاعتماد مع تسمية الأولى حتى لو اختلف شكل الرقم)؛ (4) تعطل الذكاء الاصطناعي يبقي الإدخال اليدوي، وإعادة المحاولة تقرأ وتحاسب مرة واحدة؛ (5) الميزانية توقف الصرف: القيد يمنع حجزاً جديداً متى كان المصروف زائداً المحجوز زائداً أسوأ حالة لا يتسع في الميزانية. الميزانية **أداة ضبط بتجاوز محدود** وليست وعداً بعدم تجاوزها أبداً: إن كلّفت القراءة أكثر من حجزها يُسجَّل المبلغ الفعلي كاملاً. وقد أثبتت الاختبارات هذا بنموذج مبرمج على فواتير اصطناعية فقط، فأعيدوا التحقق مرة على المزوّد الحقيقي.

**السكربت:** `scripts/pharmacy-intake-eval.ts` يشغّل المسار الحقيقي على مجلد فواتير مع ملف `truth.csv` ويطبع لكل حقل: صحيح / فارغ صحيح / فارغ كان يجب قراءته / خاطئ / مخمَّن، والكلفة وزمن p95؛ ويخرج برمز 1 إذا وُجد أي تخمين. يرفض العمل على الإنتاج أو على قاعدة بيانات غير محلية.

**ما يُعاير بالبيانات الحقيقية:** حدود جودة الصورة (`QUALITY_LIMITS`)، وثوابت حدّ الرموز مقابل `PhAiCall.inputTokens`، وسقف الإخراج.

**قرارات مطلوبة:** صيغة اليوم/الشهر (DD/MM)؛ البحث بالعربية والكردية تحت لغة قاعدة Neon؛ قراءة الباركود من الصورة (zxing)؛ من يحق له التعديل (STOCK والمحاسب يعتمدان ولا يعدّلان)؛ الخصم والضريبة لا تدخل كلفة الإيصال (خصم أو ضريبة في رأس الفاتورة يوقف الاعتماد حتى يُقرّ شخص بسبب مكتوب أن كلفة الإيصال لا تشملهما؛ والبونص غير المطبوع يُقرأ صفراً)؛ مراجعة نصوص العربية والكردية من متحدث أصلي.

**الاحتفاظ:** الملفات تُحفظ 30 يوماً؛ جدولة `pharmacy-intake-purge.ts` و`pharmacy-intake-expire.ts` و`pharmacy-intake-sweep.ts` يومياً خطوة إطلاق.
