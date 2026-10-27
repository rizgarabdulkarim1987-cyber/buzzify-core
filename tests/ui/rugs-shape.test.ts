import { describe, expect, it } from "vitest";
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from "@/lib/templates";
import { templateForStyle } from "@/studio/styles/template-map";
import { BODIES } from "@/ui/template/bodies";
import { RugsBody } from "@/ui/template/bodies/RugsBody";
import { contrastRatio as contrast } from "@/lib/palette";
import { RUG, WEAVES, weaveOf } from "@/ui/template/bodies/rug-weave";

describe("the Jajim and Nowruz shape", () => {
  it("is registered as a body that sets the hero, the navigation, the cards and the headings", () => {
    expect(BODIES.rugs).toBe(RugsBody);
    expect(SHAPE_SETS.rugs).toEqual(
      expect.arrayContaining(["hero", "nav", "card", "heading"]),
    );
  });

  it("starts on its own preset after the earlier ones, on the themed-kurd style", () => {
    const preset = TEMPLATES["the-jajim-and-nowruz"];
    expect(TEMPLATE_IDS).toContain("the-jajim-and-nowruz");
    expect(preset.number).toBe(
      TEMPLATE_IDS.indexOf("the-jajim-and-nowruz") + 1,
    );
    expect(preset.business).toBe("restaurant");
    expect(bodyOf(preset.layout)).toBe("rugs");
    expect(preset.layout.hero).toBe("compact");
    expect(preset.scene.mode).toBe("static");
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle("themed-kurd")).toBe("the-jajim-and-nowruz");
  });
});

describe("the rugs", () => {
  it("weaves each rug from a cycle of four patterns and colourways, the same one for the same place", () => {
    expect(new Set(WEAVES.map((weave) => weave.pattern)).size).toBe(4);
    expect(weaveOf(2)).toEqual(weaveOf(2 + WEAVES.length));
    expect(weaveOf(-1).index).toBe(WEAVES.length - 1);
  });

  it("keeps every text on its fixed fill at 4.5:1: names and prices on each field, the cartouche, the pills, the swatches", () => {
    for (const weave of WEAVES) {
      expect(
        contrast(RUG.ink, weave.field),
        weave.field,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(RUG.muted, weave.field),
        weave.field,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(RUG.priceInk, weave.field),
        weave.field,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(RUG.ink, RUG.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(RUG.plateInk, RUG.plate)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(RUG.greenInk, RUG.green)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(RUG.saffronInk, RUG.saffron)).toBeGreaterThanOrEqual(4.5);
  });

  it("draws the focus ring in a colour that stands out from the strip, the page and every field (3:1)", () => {
    expect(contrast(RUG.ring, RUG.stripBacking)).toBeGreaterThanOrEqual(3);
    expect(contrast(RUG.ring, RUG.page)).toBeGreaterThanOrEqual(3);
    for (const weave of WEAVES)
      expect(contrast(RUG.ring, weave.field)).toBeGreaterThanOrEqual(3);
  });
});
