// Builds rizgar-pharmacy-products.csv for Catalog > Import. Run: node docs/pharmacy/sample-data/gen-products.mjs
import fs from 'node:fs';

// trade | generic | strength | form | maker | category | rx | pack | units | price IQD | min
const P = `
Panadol|Paracetamol|500 mg|Tablet|GSK|Pain & Fever|OTC|Box|24|2500|20
Panadol Extra|Paracetamol + Caffeine|500/65 mg|Tablet|GSK|Pain & Fever|OTC|Box|24|3500|15
Adol|Paracetamol|500 mg|Tablet|Julphar|Pain & Fever|OTC|Box|20|1500|20
Adol Syrup|Paracetamol|120 mg/5 ml|Syrup|Julphar|Pain & Fever|OTC|Bottle|1|2500|10
Brufen|Ibuprofen|400 mg|Tablet|Abbott|Pain & Fever|OTC|Box|30|4000|15
Brufen Syrup|Ibuprofen|100 mg/5 ml|Syrup|Abbott|Pain & Fever|OTC|Bottle|1|3500|10
Voltaren|Diclofenac|50 mg|Tablet|Novartis|Pain & Fever|RX|Box|20|5500|10
Voltaren Emulgel|Diclofenac|1%|Gel|Novartis|Pain & Fever|OTC|Tube|1|7500|8
Cataflam|Diclofenac Potassium|50 mg|Tablet|Novartis|Pain & Fever|RX|Box|20|6000|10
Aspirin Cardio|Acetylsalicylic Acid|100 mg|Tablet|Bayer|Cardiovascular|OTC|Box|30|3000|10
Aspirin|Acetylsalicylic Acid|500 mg|Tablet|Bayer|Pain & Fever|OTC|Box|20|2000|10
Augmentin|Amoxicillin + Clavulanic Acid|1 g|Tablet|GSK|Antibiotics|RX|Box|14|14000|10
Augmentin Syrup|Amoxicillin + Clavulanic Acid|228 mg/5 ml|Suspension|GSK|Antibiotics|RX|Bottle|1|9500|8
Amoxil|Amoxicillin|500 mg|Capsule|GSK|Antibiotics|RX|Box|20|6500|10
Zithromax|Azithromycin|500 mg|Tablet|Pfizer|Antibiotics|RX|Box|3|9000|8
Zithromax Syrup|Azithromycin|200 mg/5 ml|Suspension|Pfizer|Antibiotics|RX|Bottle|1|8500|6
Ciprobay|Ciprofloxacin|500 mg|Tablet|Bayer|Antibiotics|RX|Box|10|8000|8
Flagyl|Metronidazole|500 mg|Tablet|Sanofi|Antibiotics|RX|Box|20|4500|10
Cefixime|Cefixime|400 mg|Capsule|Sandoz|Antibiotics|RX|Box|5|7500|8
Klacid|Clarithromycin|500 mg|Tablet|Abbott|Antibiotics|RX|Box|14|13000|6
Ventolin Inhaler|Salbutamol|100 mcg|Inhaler|GSK|Respiratory|RX|Piece|1|6500|10
Seretide Evohaler|Salmeterol + Fluticasone|25/125 mcg|Inhaler|GSK|Respiratory|RX|Piece|1|32000|4
Symbicort|Budesonide + Formoterol|160/4.5 mcg|Inhaler|AstraZeneca|Respiratory|RX|Piece|1|38000|4
Mucosolvan|Ambroxol|30 mg|Tablet|Boehringer|Respiratory|OTC|Box|20|4000|10
Mucosolvan Syrup|Ambroxol|15 mg/5 ml|Syrup|Boehringer|Respiratory|OTC|Bottle|1|4500|10
Bisolvon|Bromhexine|8 mg|Tablet|Sanofi|Respiratory|OTC|Box|20|3500|10
Prospan|Ivy Leaf Extract|35 mg/5 ml|Syrup|Engelhard|Respiratory|OTC|Bottle|1|8000|8
Singulair|Montelukast|10 mg|Tablet|MSD|Respiratory|RX|Box|28|18000|6
Claritine|Loratadine|10 mg|Tablet|Bayer|Allergy|OTC|Box|10|3500|15
Aerius|Desloratadine|5 mg|Tablet|MSD|Allergy|OTC|Box|10|6500|10
Zyrtec|Cetirizine|10 mg|Tablet|UCB|Allergy|OTC|Box|10|4500|12
Telfast|Fexofenadine|120 mg|Tablet|Sanofi|Allergy|OTC|Box|10|7500|8
Nasonex|Mometasone|50 mcg|Nasal Spray|MSD|Allergy|RX|Piece|1|14000|5
Otrivin|Xylometazoline|0.1%|Nasal Spray|GSK|Allergy|OTC|Piece|1|3500|12
Nexium|Esomeprazole|40 mg|Tablet|AstraZeneca|Digestive|RX|Box|14|16000|8
Losec|Omeprazole|20 mg|Capsule|AstraZeneca|Digestive|RX|Box|14|9000|10
Controloc|Pantoprazole|40 mg|Tablet|Takeda|Digestive|RX|Box|14|11000|8
Gaviscon|Sodium Alginate|10 ml|Suspension|Reckitt|Digestive|OTC|Bottle|1|6500|10
Maalox|Aluminium + Magnesium Hydroxide|400/400 mg|Tablet|Sanofi|Digestive|OTC|Box|40|4000|10
Buscopan|Hyoscine Butylbromide|10 mg|Tablet|Boehringer|Digestive|OTC|Box|20|5000|12
Imodium|Loperamide|2 mg|Capsule|Janssen|Digestive|OTC|Box|6|3000|10
Motilium|Domperidone|10 mg|Tablet|Janssen|Digestive|OTC|Box|30|5500|10
Smecta|Diosmectite|3 g|Sachet|Ipsen|Digestive|OTC|Box|30|9500|8
ORS Oral Rehydration Salts|Electrolytes|20.5 g|Sachet|WHO|Digestive|OTC|Box|10|2500|15
Duphalac|Lactulose|667 mg/ml|Syrup|Abbott|Digestive|OTC|Bottle|1|7500|6
Glucophage|Metformin|500 mg|Tablet|Merck|Diabetes|RX|Box|50|5000|12
Glucophage XR|Metformin|750 mg|Tablet|Merck|Diabetes|RX|Box|30|6000|10
Diamicron MR|Gliclazide|60 mg|Tablet|Servier|Diabetes|RX|Box|30|9500|8
Amaryl|Glimepiride|2 mg|Tablet|Sanofi|Diabetes|RX|Box|30|7000|8
Januvia|Sitagliptin|100 mg|Tablet|MSD|Diabetes|RX|Box|28|35000|4
Lantus SoloStar|Insulin Glargine|100 IU/ml|Pen|Sanofi|Diabetes|RX|Pen|5|42000|4
Mixtard 30|Human Insulin|100 IU/ml|Vial|Novo Nordisk|Diabetes|RX|Vial|1|9000|6
Norvasc|Amlodipine|5 mg|Tablet|Pfizer|Cardiovascular|RX|Box|30|7500|10
Concor|Bisoprolol|5 mg|Tablet|Merck|Cardiovascular|RX|Box|30|8500|10
Tenormin|Atenolol|50 mg|Tablet|AstraZeneca|Cardiovascular|RX|Box|28|5500|10
Cozaar|Losartan|50 mg|Tablet|MSD|Cardiovascular|RX|Box|28|11000|8
Co-Diovan|Valsartan + Hydrochlorothiazide|160/12.5 mg|Tablet|Novartis|Cardiovascular|RX|Box|28|15000|6
Lasix|Furosemide|40 mg|Tablet|Sanofi|Cardiovascular|RX|Box|20|3000|8
Lipitor|Atorvastatin|20 mg|Tablet|Pfizer|Cardiovascular|RX|Box|30|14000|10
Crestor|Rosuvastatin|10 mg|Tablet|AstraZeneca|Cardiovascular|RX|Box|28|16000|8
Plavix|Clopidogrel|75 mg|Tablet|Sanofi|Cardiovascular|RX|Box|28|18000|6
Concor Plus|Bisoprolol + Hydrochlorothiazide|5/12.5 mg|Tablet|Merck|Cardiovascular|RX|Box|30|9500|6
Xarelto|Rivaroxaban|20 mg|Tablet|Bayer|Cardiovascular|RX|Box|28|45000|3
Eltroxin|Levothyroxine|100 mcg|Tablet|Aspen|Hormones|RX|Box|100|6000|8
Euthyrox|Levothyroxine|50 mcg|Tablet|Merck|Hormones|RX|Box|100|7000|8
Prednisolone|Prednisolone|5 mg|Tablet|Pfizer|Hormones|RX|Box|20|2500|8
Dexamethasone|Dexamethasone|4 mg/ml|Injection|Pharco|Hormones|RX|Ampoule|10|5000|6
Duphaston|Dydrogesterone|10 mg|Tablet|Abbott|Hormones|RX|Box|20|15000|5
Vitamin C 1000|Ascorbic Acid|1000 mg|Effervescent Tablet|Redoxon|Vitamins|OTC|Tube|10|6500|15
Redoxon Triple Action|Vitamin C + D + Zinc|1000 mg|Effervescent Tablet|Bayer|Vitamins|OTC|Tube|15|9500|10
Centrum|Multivitamin|1 tablet|Tablet|Pfizer|Vitamins|OTC|Bottle|30|18000|6
Neurobion|Vitamin B1 + B6 + B12|100/200/0.2 mg|Tablet|Merck|Vitamins|OTC|Box|30|7500|10
Vitamin D3 50000|Cholecalciferol|50000 IU|Capsule|Pharco|Vitamins|OTC|Box|4|6000|10
Calcium Sandoz|Calcium|500 mg|Effervescent Tablet|Sandoz|Vitamins|OTC|Tube|20|7000|8
Ferrograd Folic|Ferrous Sulphate + Folic Acid|325/0.35 mg|Tablet|Abbott|Vitamins|OTC|Box|30|4500|10
Omega 3|Fish Oil|1000 mg|Capsule|Solgar|Vitamins|OTC|Bottle|60|22000|4
Folic Acid|Folic Acid|5 mg|Tablet|Pharco|Vitamins|OTC|Box|30|1500|10
Zinc Sulphate|Zinc|20 mg|Tablet|Pharco|Vitamins|OTC|Box|30|3000|8
Betadine Solution|Povidone Iodine|10%|Solution|Mundipharma|First Aid|OTC|Bottle|1|3500|10
Dettol Antiseptic|Chloroxylenol|500 ml|Solution|Reckitt|First Aid|OTC|Bottle|1|5500|8
Hydrogen Peroxide|Hydrogen Peroxide|3%|Solution|Local|First Aid|OTC|Bottle|1|1000|10
Surgical Spirit|Ethanol|70%|Solution|Local|First Aid|OTC|Bottle|1|1500|10
Bepanthen|Dexpanthenol|5%|Ointment|Bayer|Skin|OTC|Tube|1|7500|8
Fucidin|Fusidic Acid|2%|Cream|Leo|Skin|RX|Tube|1|9000|6
Dermovate|Clobetasol|0.05%|Cream|GSK|Skin|RX|Tube|1|6500|6
Canesten|Clotrimazole|1%|Cream|Bayer|Skin|OTC|Tube|1|6000|8
Daktarin|Miconazole|2%|Gel|Janssen|Skin|OTC|Tube|1|7500|6
Fucibet|Fusidic Acid + Betamethasone|2%/0.1%|Cream|Leo|Skin|RX|Tube|1|10000|5
Soframycin|Framycetin|1%|Ointment|Sanofi|Skin|OTC|Tube|1|3500|8
Eucerin Urea Cream|Urea|5%|Cream|Beiersdorf|Skin|OTC|Tube|1|18000|4
Vitrac Eye Drops|Hypromellose|0.3%|Eye Drops|Local|Eyes & Ears|OTC|Bottle|1|4500|8
Tobrex|Tobramycin|0.3%|Eye Drops|Alcon|Eyes & Ears|RX|Bottle|1|7500|6
Otosporin|Polymyxin + Neomycin + Hydrocortisone|10 ml|Ear Drops|GSK|Eyes & Ears|RX|Bottle|1|6000|5
Strepsils|Amylmetacresol + Dichlorobenzyl Alcohol|1.2/0.6 mg|Lozenge|Reckitt|Throat|OTC|Pack|24|4500|15
Difflam Spray|Benzydamine|0.15%|Spray|iNova|Throat|OTC|Piece|1|9500|6
Tantum Verde|Benzydamine|0.15%|Mouthwash|Angelini|Throat|OTC|Bottle|1|8000|6
Coldrex|Paracetamol + Phenylephrine + Vitamin C|500 mg|Sachet|Reckitt|Cold & Flu|OTC|Box|10|5500|12
Fervex|Paracetamol + Pheniramine + Vitamin C|500 mg|Sachet|UPSA|Cold & Flu|OTC|Box|8|7000|10
Panadol Cold & Flu|Paracetamol + Phenylephrine|500/5 mg|Tablet|GSK|Cold & Flu|OTC|Box|24|5000|12
Sinex|Oxymetazoline|0.05%|Nasal Spray|P&G|Cold & Flu|OTC|Piece|1|4500|8
Digital Thermometer|Device|1 piece|Device|Medela|Devices|OTC|Piece|1|6000|6
Accu-Chek Active Strips|Glucose Test Strips|50 strips|Strips|Roche|Devices|OTC|Box|50|22000|6
Blood Pressure Monitor|Device|1 piece|Device|Omron|Devices|OTC|Piece|1|65000|3
Surgical Face Mask|Mask|50 pieces|Mask|Local|Devices|OTC|Box|50|3500|15
Disposable Syringe 5 ml|Syringe|5 ml|Syringe|Local|Devices|OTC|Box|100|7500|8
Elastic Bandage|Bandage|10 cm|Bandage|Local|First Aid|OTC|Piece|1|2000|10
Adhesive Plasters|Plaster|20 pieces|Plaster|Local|First Aid|OTC|Box|20|1500|15
Cotton Wool|Cotton|100 g|Cotton|Local|First Aid|OTC|Pack|1|2000|10
Sterile Gauze 10x10|Gauze|10 x 10 cm|Gauze|Local|First Aid|OTC|Pack|10|2500|10
Pampers Diapers Size 3|Diapers|Size 3|Diapers|P&G|Baby|OTC|Pack|58|17000|6
Johnson Baby Shampoo|Shampoo|200 ml|Shampoo|J&J|Baby|OTC|Bottle|1|5500|8
Infacare Milk 1|Infant Formula|400 g|Powder|Nutricia|Baby|OTC|Tin|1|15000|6
Nivea Soft Cream|Moisturizer|200 ml|Cream|Beiersdorf|Personal Care|OTC|Jar|1|6500|6
Colgate Total|Toothpaste|100 ml|Toothpaste|Colgate|Personal Care|OTC|Tube|1|3500|12
Sensodyne Original|Toothpaste|75 ml|Toothpaste|GSK|Personal Care|OTC|Tube|1|6500|8
`.trim().split('\n').map((l) => l.split('|'));

// In-store EAN-13 (prefix 200 is reserved for shop use), so no code collides with a real product.
function ean13(base12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(base12[i]) * (i % 2 ? 3 : 1);
  return base12 + ((10 - (s % 10)) % 10);
}

const head = ['Trade Name', 'Generic Name', 'Strength', 'Form', 'Manufacturer', 'Category', 'Rx Level', 'Pack', 'Units Per Pack', 'Barcode', 'Sale Price', 'Currency', 'Min Qty'];
const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const rows = P.map(([t, g, s, f, m, c, rx, pk, u, pr, mn], i) => [
  t, g, s, f, m, c, rx, pk, u, ean13('2000' + String(100000 + i * 7).padStart(8, '0')), pr, 'IQD', mn,
]);
const out = new URL('./rizgar-pharmacy-products.csv', import.meta.url);
fs.writeFileSync(out, '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n');
console.log(rows.length, 'products');
