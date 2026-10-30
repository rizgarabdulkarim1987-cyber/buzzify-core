# UAT sign-off sheet / ورقة الاعتماد

Pharmacy / الصيدلية: ______________________  Branch / الفرع: ______________  Date / التاريخ: ____________
Build or commit tested / النسخة المختبرة: ______________________  Database: TRIAL business only / نشاط تجريبي فقط

Mark each step PASS / FAIL / N/A. A FAIL on a step marked (stop) blocks launch. / ضع نجح أو فشل أو لا ينطبق. فشل خطوة (إيقاف) يمنع الإطلاق.

| Scenario / السيناريو | Phase / المرحلة | Who tested / من اختبر | Steps PASS | Steps FAIL | (stop) steps all PASS? | Notes / ملاحظات |
|---|---|---|---|---|---|---|
| 1 Opening / فتح الصيدلية | 0-2 | | | | | |
| 2 Receive stock / استلام | 2, 4 | | | | | |
| 3 Sell without Rx / بيع دون وصفة | 3 | | | | | |
| 4 Sell with Rx / بيع بوصفة | 3, 7 | | | | | |
| 5 Controlled drug / مادة مراقبة | 7 | | | | | |
| 6 Credit / بيع آجل | 7 | | | | | |
| 7 Return / مرتجع | 3 | | | | | |
| 8 Close shift / إغلاق الوردية | 3 | | | | | |
| 9 Transfer / تحويل | 6 | | | | | |
| 10 Count / جرد | 2 | | | | | |
| 11 Expiry, damaged / انتهاء وتالف | 2 | | | | | |
| 12 Reports, export / تقارير وتصدير | 6 | | | | | |
| 13 Assistant / المساعد | 7 | | | | | |
| 14 Print / طباعة | 3, 7 | | | | | |
| 15 Buying / الشراء | 4, 5 | | | | | |
| 16 Who sees what / الصلاحيات | all | | | | | |

## Step log / سجل الخطوات

Copy one line per step that did not pass, or that confused the user even though it passed. / سطر لكل خطوة لم تنجح أو أربكت المستخدم.

| Step (e.g. 4.3) | PASS / FAIL | What happened | Severity (blocks launch / fix soon / nice to have) | Initials |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |
| | | | | |

## Questions only the owner can answer / أسئلة للمالك

- [ ] Language review of the Arabic and Kurdish screens by a native speaker done / مراجعة العربية والكردية من متحدث أصلي
- [ ] Official maximum drug prices: yes / no (not enforced today) / سقف الأسعار الرسمي
- [ ] Prescription retention period decided (default 3650 days, nothing is deleted) / مدة حفظ الوصفات
- [ ] Hardware actually used (scanner, thermal 80/58 mm, label printer) recorded / الأجهزة المستعملة
- [ ] Sells in dollars as well as dinars: yes / no / البيع بالدولار
- [ ] Stock clerk may adjust stock: yes / no / صلاحية تعديل المخزون لأمين المخزن

## Sign-off / الاعتماد

I confirm the scenarios above were run on a trial business, with the results recorded, and I accept the pharmacy for launch / I do not accept it until the (stop) failures are fixed.

أؤكد أن السيناريوهات أعلاه نُفذت على نشاط تجريبي وسُجلت نتائجها، وأقبل الصيدلية للإطلاق / لا أقبلها حتى تُصلح إخفاقات (إيقاف).

| Role / الدور | Name / الاسم | Decision: accept / reject / القرار | Signature / التوقيع | Date / التاريخ |
|---|---|---|---|---|
| Owner / المالك | | | | |
| Pharmacist in charge / الصيدلي المسؤول | | | | |
| Cashier / الكاشير | | | | |
| Accountant / المحاسب | | | | |
