import type { LabelSize } from '@/server/domain/pharmacy/print-settings';
import { LABEL_BOX, labelBarcode, PAD_MM, priceText, type LabelItem } from './print-logic';

/** Text size and bar height per label size (points and millimetres). Fixed, so a label looks the same on every screen. */
const LOOK: Record<LabelSize, { name: number; line: number; barMm: number }> = {
  '40x25': { name: 7, line: 6, barMm: 8 },
  '50x30': { name: 8, line: 6.5, barMm: 11 },
  '58': { name: 9, line: 7.5, barMm: 15 },
};

/**
 * One label, the size it prints at: product name and strength, the price (only when `showPrice`), the batch and expiry on a batch label, and the
 * barcode as a Code 128 SVG drawn here from the encoder (no network, no library, no animation). A barcode that cannot be drawn, or would be too
 * narrow to print reliably, is said in words instead of drawn wrong. Black on white, so it prints the same in every theme.
 */
export function LabelView({ item, size, showPrice, labels }: { item: LabelItem; size: LabelSize; showPrice: boolean; labels: { noBarcode: string; tooNarrow: string; lot: string; expiry: string } }) {
  const box = LABEL_BOX[size];
  const look = LOOK[size];
  const price = showPrice ? priceText(item.price) : null;
  const fit = item.barcode ? labelBarcode(item.barcode, box.widthMm) : null;
  const meta = [item.strength, item.form].filter((p) => p.trim() !== '').join(' · ');
  return (
    <div
      data-testid="label"
      data-kind={item.lot !== null ? 'batch' : 'shelf'}
      className="box-border flex shrink-0 flex-col overflow-hidden bg-white text-black [break-after:page] print:border-0"
      style={{ width: `${box.widthMm}mm`, height: `${box.heightMm}mm`, padding: `${PAD_MM}mm`, fontSize: `${look.line}pt`, lineHeight: 1.15 }}
    >
      <p className="overflow-hidden font-bold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]" style={{ fontSize: `${look.name}pt` }} data-testid="label-name">
        <bdi dir="auto">{item.name}</bdi>
      </p>
      {meta && (
        <p className="truncate" data-testid="label-meta">
          <bdi dir="auto">{meta}</bdi>
        </p>
      )}
      {item.lot !== null && (
        <p className="truncate" data-testid="label-batch">
          {labels.lot} <bdi dir="ltr">{item.lot}</bdi>
          {item.expiry && (
            <>
              {' · '}
              {labels.expiry} <bdi dir="ltr">{item.expiry}</bdi>
            </>
          )}
        </p>
      )}
      {price && (
        <p className="font-bold" style={{ fontSize: `${look.name + 1}pt` }} data-testid="label-price">
          <bdi dir="ltr">
            {price} {item.price?.currency}
          </bdi>
        </p>
      )}
      <div className="mt-auto flex flex-col items-center">
        {fit && fit.ok && fit.fits ? (
          <svg
            role="img"
            aria-label={item.barcode ?? ''}
            data-testid="label-barcode"
            data-code={item.barcode ?? ''}
            viewBox={`0 0 ${fit.viewModules} 1`}
            width={`${fit.widthMm}mm`}
            height={`${look.barMm}mm`}
            preserveAspectRatio="none"
            shapeRendering="crispEdges"
          >
            {fit.bars.map((b) => (
              <rect key={b.x} x={b.x} y={0} width={b.w} height={1} fill="#000" />
            ))}
          </svg>
        ) : (
          <p className="font-medium" data-testid="label-no-barcode">
            {item.barcode === null ? labels.noBarcode : labels.tooNarrow}
          </p>
        )}
        {item.barcode && fit && fit.ok && fit.fits && (
          <p className="tabular-nums" data-testid="label-code">
            <bdi dir="ltr">{item.barcode}</bdi>
          </p>
        )}
      </div>
    </div>
  );
}
