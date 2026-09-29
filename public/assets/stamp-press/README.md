# Physical stamp

`walnut-stamp.avif` is the 768px transparent delivery asset (AVIF quality70,
effort6, 4:4:4). The full-resolution generated PNG and prior WebP are preserved
under `tmp/artwork-originals/public/assets/stamp-press/`, outside the deployed
public directory. The shared
`StampPress` component animates this object; the existing rubric artwork remains
the final, theme-colored impression.

The first generation established a worn dark walnut handle, brass collar and
round brass body with a vermilion rubber pad. The selected refinement prompt:

> Precise-object-edit for transparent animation sprite. Preserve this beautiful
> single walnut/brass rubber stamp and material quality, but change ONLY its
> camera view and orientation: it must stand upright as if just about to press
> downward onto a horizontal tabletop, with the handle pointing UP to the top
> edge and the circular base level with the imaginary tabletop. Camera looks
> down from ABOVE at a 45-degree angle. We see the TOP of the round brass base
> surrounding the handle and a THIN dark vermilion rubber rim at its lower edge.
> Do NOT show the red underside/printing surface at all. Front-center symmetrical
> composition with vertical handle and horizontal ellipse base, no leftward
> lean. Full object centered, 10% transparent safety margin on all sides. Actual
> transparent alpha background, no tabletop or floor or paper, no cast shadow
> outside the stamp, no other objects, no text. This should look like a poised
> literal stamp, ready to be pushed straight down by an invisible hand.

No CLI or external image API fallback was used.
